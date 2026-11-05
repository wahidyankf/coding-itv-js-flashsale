import {
	cleanup as cleanupBackend,
	migratedDatabase,
	query,
	startApi,
	world,
} from "../../../flash-be-e2e/steps/support/world.js";
import { forwarder } from "./forwarder.js";

export { query, world };

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

export async function insertSale(
	stock: number,
	sold: number,
	opens: string,
	closes: string,
): Promise<void> {
	await ensureDatabase();
	const now = new Date();
	const rows = await query<{ id: string }>(
		`insert into sales (name, starts_at, ends_at, stock, sold)
		 values ('Flash sale', $1, $2, $3, $4) returning id`,
		[relativeTime(opens, now), relativeTime(closes, now), stock, sold],
	);
	const id = rows[0]?.id;
	if (!id) throw new Error("the sale was not inserted");
	world.saleId = id;
}

// The scenario's own flash-be, started on first use.
export async function privateApi(): Promise<string> {
	await ensureDatabase();
	return startApi();
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
	await forwarder.reset();
	await cleanupBackend();
}
