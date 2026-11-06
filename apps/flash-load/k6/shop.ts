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

// The API, as the shopper meets it. A refusal is `{ errorCode, errorMessage }` with the status that goes with it.
const TICKET_HEADER = "x-queue-ticket";
const STATUS = {
	ok: 200,
	created: 201,
	paymentFailed: 402,
	alreadyPurchased: 409,
	rateLimited: 429,
	firstServerError: 500,
} as const;
const FIRST_ERROR_STATUS = 400;
const BYTE = 255;
const BYTE_BITS = 8;

// How a shopper behaves. Each number is a choice about the load, not a limit of the system.
// A join answered 429 is tried again this many times, then the shopper gives up.
const MAX_JOIN_RETRIES = 3;
// The place is checked this many times, a second or two apart, before the shopper stops waiting.
const MAX_POLLS = 90;
// A declined payment is tried this many times in all.
const MAX_PAYMENT_ATTEMPTS = 3;
// The share of buyers who press confirm a second time.
const REPEAT_CONFIRM_SHARE = 0.2;
// Latecomers get addresses far from the shoppers' range, so the two never share one.
const LATECOMER_ID_OFFSET = 1_000_000;
// Latecomers arrive at a steady rate, with their own pool of virtual users, once every hold has lapsed plus a margin.
const LATECOMERS_PER_SECOND = 10;
const LATECOMER_PRE_ALLOCATED_VUS = 50;
const LATECOMER_MAX_VUS = 200;
const LAPSE_MARGIN_SECONDS = 2;
// How many joins one hammering shopper sends.
const HAMMER_REQUESTS = 60;
// A pause is a fixed time plus a random part, in seconds, so shoppers do not move in step.
type Pause = { min: number; spread: number };
const POLL_PAUSE: Pause = { min: 1, spread: 1 };
const THINK_BEFORE_PAYING: Pause = { min: 0.2, spread: 0.8 };
const BEFORE_PAYMENT_RETRY: Pause = { min: 0.3, spread: 0.4 };

// What the runner compares with Postgres afterwards.
const purchased = new Counter("purchased");
const reserved = new Counter("reserved");
const soldOutReplies = new Counter("sold_out_replies");
const rateLimited = new Counter("rate_limited");
const serverErrors = new Counter("server_errors");

// A refusal such as 409 or 429 is an answer. Only a 5xx or no answer counts as a failed request.
http.setResponseCallback(
	http.expectedStatuses({
		min: STATUS.ok,
		max: STATUS.firstServerError - 1,
	}),
);

// The limits are set on every profile so k6 always reports the speed. The runner decides which profiles are judged
// on it: one that breaks a dependency is judged on its invariants only.
const speed = {
	"http_req_duration{name:reserve}": [`p(95)<${LIMITS.reserveP95Ms}`],
	"http_req_duration{name:purchase}": [`p(95)<${LIMITS.purchaseP95Ms}`],
	server_errors: [`count<=${LIMITS.serverErrors}`],
};

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
		latecomers: {
			executor: "constant-arrival-rate",
			exec: "latecomer",
			rate: LATECOMERS_PER_SECOND,
			timeUnit: "1s",
			duration: `${profile.latecomers / LATECOMERS_PER_SECOND}s`,
			// After the last shopper has arrived and the last hold they could have left has lapsed.
			startTime: `${profile.users / profile.arrivalsPerSecond + profile.holdSeconds + LAPSE_MARGIN_SECONDS}s`,
			preAllocatedVUs: LATECOMER_PRE_ALLOCATED_VUS,
			maxVUs: LATECOMER_MAX_VUS,
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

// The fields of a reply that the shopper reads. Which ones are there depends on the request.
type Body = {
	ticket?: string;
	state?: string;
	status?: string;
	reservationId?: string;
	purchaseId?: string;
	errorCode?: string;
};
type Answer = { status: number; body: Body };

// The reply when the API did not refuse it.
function bodyOf(answer: Answer): Body | undefined {
	return answer.status < FIRST_ERROR_STATUS ? answer.body : undefined;
}

// The `errorCode` of a refusal.
function errorOf(answer: Answer): string | undefined {
	return answer.status >= FIRST_ERROR_STATUS
		? answer.body.errorCode
		: undefined;
}

type Send = { headers?: Record<string, string>; body?: object };

// One request. The user's address goes in X-Forwarded-For, which the API trusts behind the proxy, so each shopper is
// limited on their own and not as one address.
function call(
	method: "GET" | "POST",
	path: string,
	name: string,
	address: string,
	{ headers = {}, body }: Send = {},
): Answer {
	const params = {
		headers: {
			...headers,
			...(body && { "content-type": "application/json" }),
			"x-forwarded-for": address,
		},
		tags: { name },
	};
	const url = `${BASE}${path}`;
	const response =
		method === "GET"
			? http.get(url, params)
			: http.post(url, body ? JSON.stringify(body) : null, params);
	if (response.status === 0 || response.status >= STATUS.firstServerError)
		serverErrors.add(1);
	if (response.status === STATUS.rateLimited) rateLimited.add(1);
	// A gateway error page is not JSON; the status says enough.
	const isJson = String(response.headers["Content-Type"]).includes("json");
	return {
		status: response.status,
		body: isJson ? (response.json() as Body) : {},
	};
}

const address = (index: number) =>
	`10.${(index >> (BYTE_BITS * 2)) & BYTE}.${(index >> BYTE_BITS) & BYTE}.${index & BYTE}`;

const pause = ({ min, spread }: Pause) => sleep(min + Math.random() * spread);

// One shopper, from the first click to the answer to "did I get it".
function visit(user: string, index: number): void {
	const where = address(index);
	const join = () =>
		call("POST", `/sales/${SALE}/queue`, "join", where, {
			body: { userId: user },
		});

	let joined = join();
	for (
		let tries = 0;
		errorOf(joined) === "rate_limited" && tries < MAX_JOIN_RETRIES;
		tries++
	) {
		pause(POLL_PAUSE);
		joined = join();
	}
	// 409 means the sale is over or sold out. That is a fair answer, not a failure.
	const entry = bodyOf(joined);
	if (!entry) return;

	const headers = { [TICKET_HEADER]: entry.ticket ?? "" };

	// Wait to be let in. The page does the same by following the place stream.
	let state = entry.state ?? "";
	for (let polls = 0; state !== "admitted" && polls < MAX_POLLS; polls++) {
		pause(POLL_PAUSE);
		const place = bodyOf(
			call("GET", `/sales/${SALE}/queue/${user}`, "place", where, { headers }),
		);
		if (!place) return;
		state = place.state ?? "";
		if (state === "admitted") break;
		// The queue stops admitting when the sale is over or sold out. The page learns that from the sale stream and
		// stops waiting, so a shopper here reads the sale alongside the place.
		const sale = bodyOf(call("GET", `/sales/${SALE}`, "sale", where));
		if (sale?.status === "sold_out" || sale?.status === "ended") return;
	}
	if (state !== "admitted") return;

	// Ask for an item once. A sold out answer is final for this shopper: holds that lapse later are for those who
	// arrive later, which the latecomers below stand for.
	const reserve = () =>
		call("POST", `/sales/${SALE}/reservations`, "reserve", where, {
			headers,
			body: { userId: user },
		});
	const hold = reserve();
	if (errorOf(hold) === "sold_out") {
		soldOutReplies.add(1);
		return;
	}
	const held = bodyOf(hold);
	if (!held) return;
	if (hold.status === STATUS.created) reserved.add(1);

	if (Math.random() < profile.abandonShare) return;
	pause(THINK_BEFORE_PAYING);

	const confirm = (name: string) =>
		call("POST", `/sales/${SALE}/purchases`, name, where, {
			body: { userId: user, reservationId: held.reservationId },
		});
	let bought = confirm("purchase");
	for (
		let attempt = 1;
		attempt < MAX_PAYMENT_ATTEMPTS && bought.status === STATUS.paymentFailed;
		attempt++
	) {
		pause(BEFORE_PAYMENT_RETRY);
		bought = confirm("purchase");
	}
	const purchase = bodyOf(bought);
	if (bought.status === STATUS.created) purchased.add(1);

	// One shopper in five presses the button again. The second answer must repeat the first, and a second item must
	// not be given.
	if (
		bought.status === STATUS.created &&
		Math.random() < REPEAT_CONFIRM_SHARE
	) {
		const again = confirm("purchase_again");
		const second = reserve();
		check(null, {
			"a repeated confirm gives the same purchase": () =>
				again.status === STATUS.ok &&
				bodyOf(again)?.purchaseId === purchase?.purchaseId,
			"a second reserve is refused": () =>
				second.status === STATUS.alreadyPurchased &&
				errorOf(second) === "already_purchased",
		});
	}

	// "Did I get it" must agree with what happened.
	const outcome = call(
		"GET",
		`/sales/${SALE}/purchases/${user}`,
		"outcome",
		where,
	);
	check(null, {
		"the outcome agrees with the purchase": () =>
			outcome.status === STATUS.ok &&
			(bodyOf(outcome)?.state === "purchased") ===
				(bought.status === STATUS.created),
	});
}

export function shopper(): void {
	const index = exec.scenario.iterationInTest + 1;
	visit(`shopper-${index}`, index);
}

// Shoppers who arrive after every hold has lapsed. They take the items that abandoned holds gave back.
export function latecomer(): void {
	const index = exec.scenario.iterationInTest + 1;
	visit(`late-${index}`, LATECOMER_ID_OFFSET + index);
}

// A shopper who sends request after request. Past the limit the API must answer 429, never an error.
export function hammer(): void {
	const id = exec.vu.idInTest;
	const user = `hammer-${id}`;
	for (let sent = 0; sent < HAMMER_REQUESTS; sent++) {
		call("POST", `/sales/${SALE}/queue`, "hammer", `192.0.2.${id}`, {
			body: { userId: user },
		});
	}
}
