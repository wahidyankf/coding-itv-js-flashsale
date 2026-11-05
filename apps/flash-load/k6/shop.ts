import { check, sleep } from "k6";
import exec from "k6/execution";
import http from "k6/http";
import { Counter } from "k6/metrics";
import type { Options } from "k6/options";
import { LIMITS, PROFILES, type ProfileName } from "./profiles.ts";

const profileName = (__ENV.PROFILE ?? "smoke") as ProfileName;
const profile = PROFILES[profileName];
const BASE = __ENV.BASE_URL ?? "http://nginx";
const SALE = __ENV.SALE_ID ?? "";

// What the runner compares with Postgres afterwards.
const purchased = new Counter("purchased");
const reserved = new Counter("reserved");
const soldOutReplies = new Counter("sold_out_replies");
const rateLimited = new Counter("rate_limited");
const serverErrors = new Counter("server_errors");

// A refusal such as 409 or 429 is an answer. Only a 5xx or no answer counts as a failed request.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

const speed = profile.judgeSpeed
	? {
			"http_req_duration{name:reserve}": [`p(95)<${LIMITS.reserveP95Ms}`],
			"http_req_duration{name:purchase}": [`p(95)<${LIMITS.purchaseP95Ms}`],
			server_errors: [`count<=${LIMITS.serverErrors}`],
		}
	: {};

export const options: Options = {
	scenarios: {
		shoppers: {
			executor: "constant-arrival-rate",
			exec: "shopper",
			rate: profile.arrivalsPerSecond,
			timeUnit: "1s",
			duration: `${profile.users / profile.arrivalsPerSecond}s`,
			preAllocatedVUs: profile.preAllocatedVUs,
			maxVUs: profile.maxVUs,
		},
		hammer: {
			executor: "per-vu-iterations",
			exec: "hammer",
			vus: profile.hammerUsers,
			iterations: 1,
		},
	},
	thresholds: speed,
	summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

type Answer = { status: number; json: Record<string, unknown> };

// One request. The user's address goes in X-Forwarded-For, which the API trusts behind the proxy, so each shopper is
// limited on their own and not as one address.
function call(
	method: "GET" | "POST",
	path: string,
	name: string,
	headers: Record<string, string>,
	body?: unknown,
): Answer {
	const url = `${BASE}/sales/${SALE}${path}`;
	const params = { headers, tags: { name } };
	const response =
		method === "GET"
			? http.get(url, params)
			: http.post(url, JSON.stringify(body ?? {}), params);
	if (response.status === 0 || response.status >= 500) serverErrors.add(1);
	if (response.status === 429) rateLimited.add(1);
	let json: Record<string, unknown> = {};
	try {
		json = response.json() as Record<string, unknown>;
	} catch {
		// Not JSON: a gateway error page, for instance. The status says enough.
	}
	return { status: response.status, json };
}

const address = (index: number) =>
	`10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}`;

const pause = (min: number, spread: number) =>
	sleep(min + Math.random() * spread);

// One shopper, from the first click to the answer to "did I get it".
export function shopper(): void {
	const index = exec.scenario.iterationInTest + 1;
	const user = `shopper-${index}`;
	const headers = {
		"content-type": "application/json",
		"x-forwarded-for": address(index),
	};

	let joined = call("POST", "/queue", "join", headers, { userId: user });
	for (let tries = 0; joined.status === 429 && tries < 3; tries++) {
		pause(1, 1);
		joined = call("POST", "/queue", "join", headers, { userId: user });
	}
	// 409 means the sale is over or sold out. That is a fair answer, not a failure.
	if (joined.status !== 200 && joined.status !== 201) return;

	const ticket = String(joined.json.ticket);
	const authed = { ...headers, "x-queue-ticket": ticket };

	// Wait to be let in. The page does the same by following the place stream.
	let state = joined.json.state;
	for (let polls = 0; state !== "admitted" && polls < 90; polls++) {
		pause(1, 1);
		const place = call("GET", `/queue/${user}`, "place", authed);
		if (place.status !== 200) return;
		state = place.json.state;
	}
	if (state !== "admitted") return;

	// Ask for an item. When the gate says sold out, other holds may still lapse, so a shopper tries again a few times.
	let held: Record<string, unknown> | undefined;
	for (let attempt = 0; attempt < 5; attempt++) {
		const hold = call("POST", "/reservations", "reserve", authed, {
			userId: user,
		});
		if (hold.status === 201 || hold.status === 200) {
			if (hold.status === 201) reserved.add(1);
			held = hold.json;
			break;
		}
		if (hold.status === 409 && hold.json.error === "sold_out") {
			soldOutReplies.add(1);
			pause(3, 2);
			continue;
		}
		return;
	}
	if (!held) return;

	if (Math.random() < profile.abandonShare) return;
	pause(0.2, 0.8);

	let bought: Answer | undefined;
	for (let attempt = 0; attempt < 3; attempt++) {
		bought = call("POST", "/purchases", "purchase", authed, {
			userId: user,
			reservationId: held.reservationId,
		});
		if (bought.status !== 402) break;
		pause(0.3, 0.4);
	}
	if (bought?.status === 201) purchased.add(1);

	// One shopper in five presses the button again. The second answer must repeat the first, and a second item must
	// not be given.
	if (bought?.status === 201 && Math.random() < 0.2) {
		const again = call("POST", "/purchases", "purchase_again", authed, {
			userId: user,
			reservationId: held.reservationId,
		});
		const second = call("POST", "/reservations", "reserve_again", authed, {
			userId: user,
		});
		check(null, {
			"a repeated confirm gives the same purchase": () =>
				again.status === 200 &&
				again.json.purchaseId === bought?.json.purchaseId,
			"a second reserve is refused": () =>
				second.status === 409 && second.json.error === "already_purchased",
		});
	}

	// "Did I get it" must agree with what happened.
	const outcome = call("GET", `/purchases/${user}`, "outcome", authed);
	check(null, {
		"the outcome agrees with the purchase": () =>
			outcome.status === 200 &&
			(outcome.json.state === "purchased") === (bought?.status === 201),
	});
}

// A shopper who sends request after request. Past the limit the API must answer 429, never an error.
export function hammer(): void {
	const id = exec.vu.idInTest;
	const user = `hammer-${id}`;
	const headers = {
		"content-type": "application/json",
		"x-forwarded-for": `192.0.2.${id}`,
	};
	for (let sent = 0; sent < 60; sent++) {
		call("POST", "/queue", "hammer", headers, { userId: user });
	}
}
