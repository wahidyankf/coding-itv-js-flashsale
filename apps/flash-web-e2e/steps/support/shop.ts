import {
	cleanup as cleanupBackend,
	createOperator,
	E2E_OPERATOR,
	E2E_PASSWORD,
	migratedDatabase,
	query,
	startApi,
	world,
} from "../../../flash-be-e2e/steps/support/world.js";
import { salePath, TICKET_HEADER } from "./api.js";
import { forwarder } from "./forwarder.js";

export { E2E_PASSWORD, query, world };

// True when a step has already chosen where the web server's API address leads.
const shop: { chosen: boolean } = { chosen: false };

const HOUR_MS = 3_600_000;

// Reads phrases such as "in 2 hours" and "1 hour ago" against a given moment.
function relativeTime(phrase: string, now: Date): Date {
	const ahead = /^in (\d+) hours?$/.exec(phrase);
	if (ahead) return new Date(now.getTime() + Number(ahead[1]) * HOUR_MS);
	const past = /^(\d+) hours? ago$/.exec(phrase);
	if (past) return new Date(now.getTime() - Number(past[1]) * HOUR_MS);
	throw new Error(`cannot read the time "${phrase}"`);
}

export async function ensureDatabase(): Promise<void> {
	if (!world.databaseUrl) await migratedDatabase();
}

// What a scenario said about its sale. The sale is made when the scenario's flash-be starts, so the steps that come
// after it (a slow queue, a short hold) can still shape it, the way they shape the API's environment.
type SalePlan = {
	stock: number;
	sold: number;
	opens: Date;
	closes: Date;
	holdSeconds?: number;
	admitPerSecond?: number;
};
let planned: SalePlan | undefined;

// The `cookie` header for what a reply set: the cookies that were given a value, not the ones that were cleared.
function cookieHeaderOf(reply: Response): string {
	return reply.headers
		.getSetCookie()
		.filter((cookie) => !cookie.includes("Max-Age=0"))
		.map((cookie) => cookie.split(";")[0])
		.join("; ");
}

async function postAuth(
	api: string,
	path: string,
	body: object,
): Promise<Response> {
	return fetch(`${api}${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

function logins(): Map<string, string> {
	world.logins ??= new Map();
	return world.logins;
}

// The cookie header of a user of the scenario's own flash-be, as a client other than the page would hold it. The account
// is made the first time (a sign up logs in); when the page or an earlier step made it, it is logged in to.
export async function cookieFor(
	username: string,
	password = E2E_PASSWORD,
	apiUrl?: string,
): Promise<string> {
	const key = username.trim().toLowerCase();
	const known = logins().get(key);
	if (known !== undefined) return known;
	const api = apiUrl ?? (await privateApi());
	const body = { username: key, password };
	let reply = await postAuth(api, "/auth/login", body);
	if (reply.status === UNAUTHORIZED) {
		reply = await postAuth(api, "/auth/register", body);
	}
	if (!reply.ok) {
		throw new Error(
			`${key} got no login: ${reply.status} ${await reply.text()}`,
		);
	}
	const cookie = cookieHeaderOf(reply);
	logins().set(key, cookie);
	return cookie;
}

// An account that exists but is not logged in anywhere, made as a deployment's sign up would.
export async function createAccount(
	username: string,
	password: string,
): Promise<void> {
	const api = await privateApi();
	const reply = await postAuth(api, "/auth/register", {
		username: username.trim().toLowerCase(),
		password,
	});
	if (reply.status !== CREATED) {
		throw new Error(`${username} was not made: ${reply.status}`);
	}
}

const UNAUTHORIZED = 401;
const CREATED = 201;

// The operator is made with the command, as in a deployment, and logs in through the API. The web server never gets the
// cookie: the sale is made on flash-be directly and not through the browser's proxy.
async function operatorCookie(api: string): Promise<string> {
	const known = logins().get(E2E_OPERATOR);
	if (known !== undefined) return known;
	createOperator(E2E_OPERATOR, E2E_PASSWORD);
	const reply = await postAuth(api, "/auth/login", {
		username: E2E_OPERATOR,
		password: E2E_PASSWORD,
	});
	if (!reply.ok) throw new Error(`the operator got no login: ${reply.status}`);
	const cookie = cookieHeaderOf(reply);
	logins().set(E2E_OPERATOR, cookie);
	return cookie;
}

export function planSale(
	stock: number,
	sold: number,
	opens: string,
	closes: string,
): void {
	const now = new Date();
	planned = {
		stock,
		sold,
		opens: relativeTime(opens, now),
		closes: relativeTime(closes, now),
	};
}

// Shapes the sale before the API starts, and changes it through the operator route after.
export async function changeSale(change: {
	holdSeconds?: number;
	admitPerSecond?: number;
	closes?: Date;
}): Promise<void> {
	if (planned) {
		planned = {
			...planned,
			...(change.holdSeconds === undefined
				? {}
				: { holdSeconds: change.holdSeconds }),
			...(change.admitPerSecond === undefined
				? {}
				: { admitPerSecond: change.admitPerSecond }),
			...(change.closes === undefined ? {} : { closes: change.closes }),
		};
		return;
	}
	const api = await privateApi();
	await operator(api, "PATCH", `/admin/sales/${world.saleId}`, {
		...(change.holdSeconds === undefined
			? {}
			: { holdSeconds: change.holdSeconds }),
		...(change.admitPerSecond === undefined
			? {}
			: { admitPerSecond: change.admitPerSecond }),
		...(change.closes === undefined
			? {}
			: { endsAt: change.closes.toISOString() }),
	});
}

// One call of the operator to flash-be, which must succeed.
async function operator(
	api: string,
	method: "POST" | "PATCH",
	path: string,
	body: object,
): Promise<{ id: string }> {
	const reply = await fetch(`${api}${path}`, {
		method,
		headers: {
			cookie: await operatorCookie(api),
			"content-type": "application/json",
		},
		body: JSON.stringify(body),
	});
	const text = await reply.text();
	if (!reply.ok)
		throw new Error(`${method} ${path} gave ${reply.status}: ${text}`);
	return JSON.parse(text) as { id: string };
}

// Shoppers u1..uN each buy one item through the real routes: sign up, queue, hold, purchase.
async function buyItems(
	api: string,
	saleId: string,
	count: number,
): Promise<void> {
	const sale = `${api}${salePath(saleId)}`;
	await Promise.all(
		Array.from({ length: count }, async (_, index) => {
			const user = `u${index + 1}`;
			const cookie = await cookieFor(user, E2E_PASSWORD, api);
			const post = (
				url: string,
				body: object,
				headers: Record<string, string> = {},
			) =>
				fetch(url, {
					method: "POST",
					headers: { "content-type": "application/json", cookie, ...headers },
					body: JSON.stringify(body),
				});
			const joined = await post(`${sale}/queue`, {});
			const { ticket } = (await joined.json()) as { ticket: string };
			const headers = { [TICKET_HEADER]: ticket };
			const deadline = Date.now() + ADMISSION_WAIT_MS;
			for (;;) {
				const place = await fetch(`${sale}/queue/me`, {
					headers: { cookie, ...headers },
				});
				if (((await place.json()) as { state: string }).state === "admitted")
					break;
				if (Date.now() > deadline) throw new Error(`${user} was not admitted`);
				await new Promise((resolve) => setTimeout(resolve, POLL_MS));
			}
			const held = await post(`${sale}/reservations`, {}, headers);
			if (held.status !== 201)
				throw new Error(`${user} got no hold: ${held.status}`);
			const { reservationId } = (await held.json()) as {
				reservationId: string;
			};
			const bought = await post(`${sale}/purchases`, { reservationId });
			if (bought.status !== 201)
				throw new Error(`${user} bought nothing: ${bought.status}`);
		}),
	);
}

const ADMISSION_WAIT_MS = 20_000;
const POLL_MS = 100;

// Makes the planned sale on the scenario's flash-be. Items can be bought only while the window is open, so a sale that is
// already over is made open, sold from, and then closed by moving its end. A sale that has not opened yet cannot be bought
// from by any route; the sold count is written to the table, as it would be by another instance.
async function makePlannedSale(api: string): Promise<void> {
	if (!planned) return;
	const plan = planned;
	planned = undefined;
	const now = Date.now();
	const over = plan.closes.getTime() <= now;
	const opened = plan.opens.getTime() <= now;
	const created = await operator(api, "POST", "/admin/sales", {
		stock: plan.stock,
		startsAt: plan.opens.toISOString(),
		endsAt: (over && plan.sold > 0
			? new Date(now + HOUR_MS)
			: plan.closes
		).toISOString(),
		...(plan.holdSeconds === undefined
			? {}
			: { holdSeconds: plan.holdSeconds }),
		...(plan.admitPerSecond === undefined
			? {}
			: { admitPerSecond: plan.admitPerSecond }),
	});
	world.saleId = created.id;
	if (plan.sold === 0) return;
	if (!opened) {
		// No route sells before the sale opens, so this one count is written to the table.
		await query("update sales set sold = $1 where id = $2", [
			plan.sold,
			created.id,
		]);
		return;
	}
	await buyItems(api, created.id, plan.sold);
	if (over) {
		await operator(api, "PATCH", `/admin/sales/${created.id}`, {
			endsAt: plan.closes.toISOString(),
		});
	}
}

// The scenario's own flash-be, started on first use, with the sale the scenario planned.
export async function privateApi(): Promise<string> {
	await ensureDatabase();
	const api = await startApi();
	await makePlannedSale(api);
	return api;
}

// Points the web server at this scenario's flash-be, unless a step has already chosen another place.
export async function connectWebServer(): Promise<void> {
	if (shop.chosen) return;
	const url = await privateApi();
	await forwarder.to(Number(new URL(url).port));
}

export async function cutWebServerOff(): Promise<void> {
	shop.chosen = true;
	await forwarder.cut();
}

export async function answerWith(status: number, body: string): Promise<void> {
	shop.chosen = true;
	await forwarder.canned(status, body);
}

export async function pointAtSharedBackend(port: number): Promise<void> {
	shop.chosen = true;
	await forwarder.to(port);
}

export function setApiEnv(extra: Record<string, string>): void {
	world.apiEnv = { ...world.apiEnv, ...extra };
}

export async function cleanup(): Promise<void> {
	shop.chosen = false;
	planned = undefined;
	await forwarder.reset();
	await cleanupBackend();
}
