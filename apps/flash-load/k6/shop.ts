import type { ApiFailure } from "@flash/contract";
import {
	buildRequest,
	parseReply,
	type Reply,
	type RequestInput,
	type Route,
	routes,
	TICKET_HEADER,
} from "@flash/contract";
import type { Result } from "@flash/typekit";
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
			rate: 10,
			timeUnit: "1s",
			duration: `${profile.latecomers / 10}s`,
			// After the last shopper has arrived and the last hold they could have left has lapsed.
			startTime: `${profile.users / profile.arrivalsPerSecond + profile.holdSeconds + 2}s`,
			preAllocatedVUs: 50,
			maxVUs: 200,
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

type Answer<R extends Route> = {
	status: number;
	result: Result<Reply<R>, ApiFailure>;
};

// The reply when the route did not refuse it, and the name of the refusal when it did.
function bodyOf<R extends Route>(
	answer: Answer<R>,
): Reply<R>["body"] | undefined {
	return answer.result.isOk() ? answer.result.value.body : undefined;
}

function errorOf<R extends Route>(
	answer: Answer<R>,
): ApiFailure["error"] | undefined {
	return answer.result.isErr() ? answer.result.error.error : undefined;
}

// One request, built and read through the contract. The user's address goes in X-Forwarded-For, which the API trusts
// behind the proxy, so each shopper is limited on their own and not as one address.
function call<R extends Route>(
	route: R,
	input: RequestInput<R>,
	name: string,
	address: string,
): Answer<R> {
	const built = buildRequest(route, input, BASE);
	const params = {
		headers: { ...built.headers, "x-forwarded-for": address },
		tags: { name },
	};
	const response =
		built.method === "GET"
			? http.get(built.url, params)
			: http.post(built.url, built.body ?? null, params);
	if (response.status === 0 || response.status >= 500) serverErrors.add(1);
	if (response.status === 429) rateLimited.add(1);
	// A gateway error page is not JSON; the status says enough, and the reply is read as a failure.
	const result = parseReply(route, {
		status: response.status,
		headers: response.headers,
		text: typeof response.body === "string" ? response.body : "",
	});
	return { status: response.status, result };
}

const address = (index: number) =>
	`10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}`;

const pause = (min: number, spread: number) =>
	sleep(min + Math.random() * spread);

// One shopper, from the first click to the answer to "did I get it".
function visit(user: string, index: number): void {
	const where = address(index);
	const params = { saleId: SALE };
	const join = () =>
		call(routes.joinQueue, { params, body: { userId: user } }, "join", where);

	let joined = join();
	for (
		let tries = 0;
		errorOf(joined) === "rate_limited" && tries < 3;
		tries++
	) {
		pause(1, 1);
		joined = join();
	}
	// 409 means the sale is over or sold out. That is a fair answer, not a failure.
	const entry = bodyOf(joined);
	if (!entry) return;

	const headers = { [TICKET_HEADER]: entry.ticket };

	// Wait to be let in. The page does the same by following the place stream.
	let state: string = entry.state;
	for (let polls = 0; state !== "admitted" && polls < 90; polls++) {
		pause(1, 1);
		const place = bodyOf(
			call(
				routes.checkPlace,
				{ params: { saleId: SALE, userId: user }, headers },
				"place",
				where,
			),
		);
		if (!place) return;
		state = place.state;
		if (state === "admitted") break;
		// The queue stops admitting when the sale is over or sold out. The page learns that from the sale stream and
		// stops waiting, so a shopper here reads the sale alongside the place.
		const sale = bodyOf(call(routes.sale, { params }, "sale", where));
		if (sale?.status === "sold_out" || sale?.status === "ended") return;
	}
	if (state !== "admitted") return;

	// Ask for an item once. A sold out answer is final for this shopper: holds that lapse later are for those who
	// arrive later, which the latecomers below stand for.
	const reserve = () =>
		call(
			routes.reserve,
			{ params, headers, body: { userId: user } },
			"reserve",
			where,
		);
	const hold = reserve();
	if (errorOf(hold) === "sold_out") {
		soldOutReplies.add(1);
		return;
	}
	const held = bodyOf(hold);
	if (!held) return;
	if (hold.status === 201) reserved.add(1);

	if (Math.random() < profile.abandonShare) return;
	pause(0.2, 0.8);

	const confirm = (name: string) =>
		call(
			routes.confirm,
			{ params, body: { userId: user, reservationId: held.reservationId } },
			name,
			where,
		);
	let bought = confirm("purchase");
	for (let attempt = 1; attempt < 3 && bought.status === 402; attempt++) {
		pause(0.3, 0.4);
		bought = confirm("purchase");
	}
	const purchase = bodyOf(bought);
	if (bought.status === 201) purchased.add(1);

	// One shopper in five presses the button again. The second answer must repeat the first, and a second item must
	// not be given.
	if (bought.status === 201 && Math.random() < 0.2) {
		const again = confirm("purchase_again");
		const second = reserve();
		check(null, {
			"a repeated confirm gives the same purchase": () =>
				again.status === 200 &&
				bodyOf(again)?.purchaseId === purchase?.purchaseId,
			"a second reserve is refused": () =>
				second.status === 409 && errorOf(second) === "already_purchased",
		});
	}

	// "Did I get it" must agree with what happened.
	const outcome = call(
		routes.outcome,
		{ params: { saleId: SALE, userId: user } },
		"outcome",
		where,
	);
	check(null, {
		"the outcome agrees with the purchase": () =>
			outcome.status === 200 &&
			(bodyOf(outcome)?.state === "purchased") === (bought.status === 201),
	});
}

export function shopper(): void {
	const index = exec.scenario.iterationInTest + 1;
	visit(`shopper-${index}`, index);
}

// Shoppers who arrive after every hold has lapsed. They take the items that abandoned holds gave back.
export function latecomer(): void {
	const index = exec.scenario.iterationInTest + 1;
	visit(`late-${index}`, 1_000_000 + index);
}

// A shopper who sends request after request. Past the limit the API must answer 429, never an error.
export function hammer(): void {
	const id = exec.vu.idInTest;
	const user = `hammer-${id}`;
	for (let sent = 0; sent < 60; sent++) {
		call(
			routes.joinQueue,
			{ params: { saleId: SALE }, body: { userId: user } },
			"hammer",
			`192.0.2.${id}`,
		);
	}
}
