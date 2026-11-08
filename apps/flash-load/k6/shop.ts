// The k6 script of the load test. Each iteration is one shopper's visit to the sale: sign up, join the queue, wait to be
// admitted, reserve an item, confirm the purchase, then ask whether they got it. scripts/bundle.ts bundles this file and
// its imports into one file, which k6 runs, so it may use only the k6 modules and the files of this app, never Node.

import {
	FIRST_ERROR_STATUS,
	FIRST_SERVER_ERROR_STATUS,
	HTTP_STATUS,
	MS_PER_SECOND,
	retry,
} from "@flash/flash-commons";
import { Err, Ok, type Result } from "@flash/typekit";
import { check, sleep } from "k6";
import exec from "k6/execution";
import http from "k6/http";
import { Counter } from "k6/metrics";
import type { Options } from "k6/options";
import { LIMITS, PROFILES, type ProfileName } from "./profiles.ts";

// The runner passes the profile and the sale through the environment (k6 `-e`).
const profileName = (__ENV.PROFILE ?? "smoke") as ProfileName;
const profile = PROFILES[profileName];
const BASE = __ENV.BASE_URL ?? "http://nginx";
const SALE_ID = __ENV.SALE_ID ?? "";
// The path of the sale. Every request for the sale starts with it.
const SALE_PATH = `/sales/${SALE_ID}`;

// The names the API uses for the queue ticket and the login. They are written here, not imported, so a renamed header fails this test.
const TICKET_HEADER = "x-queue-ticket";
const ACCESS_COOKIE = "access_token";
// The state the queue gives a shopper once they may buy.
const ADMITTED = "admitted";
// An IPv4 address is four bytes; a shopper's index is spread over the last three of them.
const BYTE = 255;
const BYTE_BITS = 8;

// How a shopper behaves. Each number is a choice about the load, not a limit of the system.
// A join answered 429 is tried again this many times, then the shopper gives up.
const MAX_JOIN_RETRIES = 3;
// The place is checked this many times, a second or two apart, before the shopper stops waiting.
const MAX_POLLS = 90;
// A declined payment is tried up to this many times in total.
const MAX_PAYMENT_ATTEMPTS = 3;
// The tries of a join: the first one, then the retries.
const JOIN_TRIES = 1 + MAX_JOIN_RETRIES;
const JOIN_BASE_MS = 2_000;
const JOIN_CAP_MS = 8_000;
const PAYMENT_BASE_MS = 600;
const PAYMENT_CAP_MS = 2_400;
// Refused shoppers wait with exponential backoff and full jitter (flash-commons `retry`), so they do not all come back at once.
// The caps keep a shopper from stalling for long.
const JOIN_BACKOFF = { baseMs: JOIN_BASE_MS, capMs: JOIN_CAP_MS };
const PAYMENT_BACKOFF = { baseMs: PAYMENT_BASE_MS, capMs: PAYMENT_CAP_MS };
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
// A pause is a fixed time plus a random part, in seconds, so shoppers do not move together.
type Pause = { min: number; spread: number };
const POLL_PAUSE: Pause = { min: 1, spread: 1 };
const THINK_BEFORE_PAYING: Pause = { min: 0.2, spread: 0.8 };

// What the runner compares with Postgres afterwards.
const purchased = new Counter("purchased");
const reserved = new Counter("reserved");
const soldOutReplies = new Counter("sold_out_replies");
const rateLimited = new Counter("rate_limited");
const serverErrors = new Counter("server_errors");

// A refusal such as 409 or 429 is an answer. Only a 5xx or no answer counts as a failed request.
http.setResponseCallback(
	http.expectedStatuses({
		min: HTTP_STATUS.ok,
		max: FIRST_SERVER_ERROR_STATUS - 1,
	}),
);

// The limits are set on every profile so k6 always reports the speed. The runner decides which profiles are judged
// on it: one that breaks a dependency is judged on its invariants only.
const speed = {
	"http_req_duration{name:reserve}": [`p(95)<${LIMITS.reserveP95Ms}`],
	"http_req_duration{name:purchase}": [`p(95)<${LIMITS.purchaseP95Ms}`],
	server_errors: [`count<=${LIMITS.serverErrors}`],
};

// The k6 options: three scenarios (the shoppers, the latecomers and the hammer), each with its own rate or count, and
// the speed limits as thresholds.
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
type Answer = {
	status: number;
	body: Body;
	// The value of the access cookie the reply set, if it set one.
	accessToken?: string;
};
type Send = { headers?: Record<string, string>; body?: object };

// What one visit carries from step to step: the shopper's address, their cookie, and the ticket that holds their place.
type Visit = { ip: string; cookie: string; ticket: string };

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

// All shoppers share one password. The accounts exist only in this test stack, so the password guards nothing.
const PASSWORD = "load-test-password";

// One request. The shopper's address goes in X-Forwarded-For, which the API trusts behind the proxy, so each shopper is
// limited on their own and not as one address.
function call(
	method: "GET" | "POST",
	path: string,
	name: string,
	ip: string,
	{ headers = {}, body }: Send = {},
): Answer {
	const params = {
		headers: {
			...headers,
			...(body && { "content-type": "application/json" }),
			"x-forwarded-for": ip,
		},
		tags: { name },
		// A virtual user plays many shoppers one after the other, so no cookie may stay with it. Each shopper sends their
		// own cookie header.
		jar: new http.CookieJar(),
	};
	const url = `${BASE}${path}`;
	const response =
		method === "GET"
			? http.get(url, params)
			: http.post(url, body ? JSON.stringify(body) : null, params);
	if (response.status === 0 || response.status >= FIRST_SERVER_ERROR_STATUS)
		serverErrors.add(1);
	if (response.status === HTTP_STATUS.tooManyRequests) rateLimited.add(1);
	// A gateway error page is not JSON; the status says enough.
	const isJson = String(response.headers["Content-Type"]).includes("json");
	const accessToken = response.cookies[ACCESS_COOKIE]?.[0]?.value;
	return {
		status: response.status,
		body: isJson ? (response.json() as Body) : {},
		...(accessToken && { accessToken }),
	};
}

// The address of shopper `index`. Every shopper has their own, so the API limits each of them on their own.
const address = (index: number) =>
	`10.${(index >> (BYTE_BITS * 2)) & BYTE}.${(index >> BYTE_BITS) & BYTE}.${index & BYTE}`;

const pause = ({ min, spread }: Pause) => sleep(min + Math.random() * spread);

// The wait that `retry` asks for is in milliseconds; k6's sleep counts seconds.
const waitMs = (ms: number) => sleep(ms / MS_PER_SECOND);

// The headers of a request that carries only the shopper's cookie.
function cookieHeaders(cookie: string): Record<string, string> {
	return { cookie };
}

// The headers of a shopper who holds a place in the queue: the cookie and the ticket the queue gave.
function ticketHeaders(me: Visit): Record<string, string> {
	return { ...cookieHeaders(me.cookie), [TICKET_HEADER]: me.ticket };
}

// A shopper signs up, which also logs them in, and gets the cookie header every later request carries. Nothing but a
// refusal of the account itself stops them: without a login the shopper cannot take part.
function signUp(user: string, ip: string): string | undefined {
	const account = call("POST", "/auth/register", "register", ip, {
		body: { username: user, password: PASSWORD },
	});
	return account.accessToken && `${ACCESS_COOKIE}=${account.accessToken}`;
}

// Joins the queue. A shopper refused for going too fast tries again, with backoff, then gives up. Returns the reply that
// holds the shopper's place, or undefined when there is none. Only a join refused as rate limited is sent again.
function joinQueue(ip: string, cookie: string): Body | undefined {
	const join = (): Result<Answer, Answer> => {
		const answer = call("POST", `${SALE_PATH}/queue`, "join", ip, {
			headers: cookieHeaders(cookie),
		});
		return errorOf(answer) === "rate_limited"
			? new Err(answer)
			: new Ok(answer);
	};
	const last = retry(join, {
		...JOIN_BACKOFF,
		maxAttempts: JOIN_TRIES,
		sleep: waitMs,
		random: Math.random,
	}).match({ ok: (answer) => answer, err: (answer) => answer });
	// 409 means the sale is over or sold out. That is a fair answer, not a failure.
	return bodyOf(last);
}

// Whether the sale has stopped letting shoppers in: it is sold out or it has ended.
function saleIsOver(ip: string): boolean {
	const sale = bodyOf(call("GET", SALE_PATH, "sale", ip));
	return sale?.status === "sold_out" || sale?.status === "ended";
}

// Waits to be let in, as the page does by following the place stream. It also reads the sale: a sale that is over or sold out admits nobody, so the wait must end.
// Returns true when the shopper is admitted.
function waitForAdmission(me: Visit, joinedState: string): boolean {
	let state = joinedState;
	for (let polls = 0; state !== ADMITTED && polls < MAX_POLLS; polls++) {
		pause(POLL_PAUSE);
		const place = bodyOf(
			call("GET", `${SALE_PATH}/queue/me`, "place", me.ip, {
				headers: ticketHeaders(me),
			}),
		);
		if (!place) return false;
		state = place.state ?? "";
		if (state !== ADMITTED && saleIsOver(me.ip)) return false;
	}
	return state === ADMITTED;
}

// The reserve request. A shopper who asks again is refused: one item per shopper.
function askForItem(me: Visit): Answer {
	return call("POST", `${SALE_PATH}/reservations`, "reserve", me.ip, {
		headers: ticketHeaders(me),
	});
}

// Asks for one item. A sold out answer is final for this shopper: holds that lapse later are for those who arrive later,
// which the latecomers below stand for. Returns the hold, or undefined when the shopper gets none.
function reserveItem(me: Visit): Body | undefined {
	const hold = askForItem(me);
	if (errorOf(hold) === "sold_out") {
		soldOutReplies.add(1);
		return undefined;
	}
	const held = bodyOf(hold);
	if (held && hold.status === HTTP_STATUS.created) reserved.add(1);
	return held;
}

// One confirm request. The name is the request's tag in the k6 results.
function buy(
	me: Visit,
	reservationId: string | undefined,
	name: string,
): Answer {
	return call("POST", `${SALE_PATH}/purchases`, name, me.ip, {
		headers: cookieHeaders(me.cookie),
		body: { reservationId },
	});
}

// Confirms the purchase. A declined payment (402) is tried again, with backoff, up to MAX_PAYMENT_ATTEMPTS in total.
// Returns the last reply. Only a declined payment is sent again.
function payForItem(me: Visit, reservationId: string | undefined): Answer {
	const confirm = (): Result<Answer, Answer> => {
		const answer = buy(me, reservationId, "purchase");
		return answer.status === HTTP_STATUS.paymentRequired
			? new Err(answer)
			: new Ok(answer);
	};
	return retry(confirm, {
		...PAYMENT_BACKOFF,
		maxAttempts: MAX_PAYMENT_ATTEMPTS,
		sleep: waitMs,
		random: Math.random,
	}).match({ ok: (answer) => answer, err: (answer) => answer });
}

// A share of buyers (REPEAT_CONFIRM_SHARE) presses confirm again. The second confirm must give back the same purchase,
// and a second reserve must be refused.
function checkRepeatPurchase(
	me: Visit,
	reservationId: string | undefined,
	bought: Answer,
): void {
	const firstPurchaseId = bodyOf(bought)?.purchaseId;
	const again = buy(me, reservationId, "purchase_again");
	const second = askForItem(me);
	check(null, {
		"a repeated confirm gives the same purchase": () =>
			again.status === HTTP_STATUS.ok &&
			bodyOf(again)?.purchaseId === firstPurchaseId,
		"a second reserve is refused": () =>
			second.status === HTTP_STATUS.conflict &&
			errorOf(second) === "already_purchased",
	});
}

// "Did I get it" must agree with what happened.
function checkOutcome(me: Visit, gotItem: boolean): void {
	const outcome = call("GET", `${SALE_PATH}/purchases/me`, "outcome", me.ip, {
		headers: cookieHeaders(me.cookie),
	});
	check(null, {
		"the outcome agrees with the purchase": () =>
			outcome.status === HTTP_STATUS.ok &&
			(bodyOf(outcome)?.state === "purchased") === gotItem,
	});
}

// One shopper, from the first click to the answer to "did I get it".
function visit(user: string, index: number): void {
	const ip = address(index);
	const cookie = signUp(user, ip);
	if (!cookie) return;
	const place = joinQueue(ip, cookie);
	if (!place) return;
	const me: Visit = { ip, cookie, ticket: place.ticket ?? "" };
	if (!waitForAdmission(me, place.state ?? "")) return;
	const held = reserveItem(me);
	if (!held) return;
	// A share of shoppers (abandonShare in the profile) walks away with the hold and does not confirm.
	if (Math.random() < profile.abandonShare) return;
	pause(THINK_BEFORE_PAYING);
	const bought = payForItem(me, held.reservationId);
	const gotItem = bought.status === HTTP_STATUS.created;
	if (gotItem) {
		purchased.add(1);
		if (Math.random() < REPEAT_CONFIRM_SHARE) {
			checkRepeatPurchase(me, held.reservationId, bought);
		}
	}
	checkOutcome(me, gotItem);
}

// One shopper at the steady rate of the main sale. Each iteration is one new shopper.
export function shopper(): void {
	const index = exec.scenario.iterationInTest + 1;
	visit(`shopper-${index}`, index);
}

// Shoppers who arrive after every hold has lapsed. They take the items that abandoned holds gave back.
export function latecomer(): void {
	const index = exec.scenario.iterationInTest + 1;
	visit(`late-${index}`, LATECOMER_ID_OFFSET + index);
}

// A shopper who sends request after request. Past the limit the API must answer 429, never an error. The hammer uses
// addresses of the documentation range (192.0.2.0/24), apart from the shoppers' range.
export function hammer(): void {
	const id = exec.vu.idInTest;
	const user = `hammer-${id}`;
	const ip = `192.0.2.${id}`;
	const cookie = signUp(user, ip);
	if (!cookie) return;
	for (let sent = 0; sent < HAMMER_REQUESTS; sent++) {
		call("POST", `${SALE_PATH}/queue`, "hammer", ip, {
			headers: cookieHeaders(cookie),
		});
	}
}
