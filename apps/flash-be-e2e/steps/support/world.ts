// The state of the scenario that is running: the sale, the logins, the replies, and the processes and database it started.
// Each scenario starts empty and cleanup.ts empties it again. The processes are in processes.ts and the database in
// database.ts; this file only holds what they leave behind.

import type { ChildProcess } from "node:child_process";
import type { APIResponse } from "@playwright/test";
import type { PurchaseView, ReservedView } from "./views.js";

// A TCP relay in front of Redis. `down` drops every connection and refuses new ones, as an unreachable Redis does; `up`
// accepts again on the same port. The data in Redis is not touched.
export type RedisProxy = {
	url: string;
	down: () => Promise<void>;
	up: () => Promise<void>;
	close: () => Promise<void>;
};

// What the shoppers of a scenario hold: their tickets, the order they joined in, their holds and purchases, and the answer
// to each request of a burst. See shoppers.ts for the calls that fill them.
export type ShopperState = {
	tickets: Map<string, string>;
	joined: string[];
	holds: Map<string, ReservedView>;
	purchases: Map<string, PurchaseView>;
	replies: Array<{
		status: number;
		error?: string | undefined;
		retryAfter?: string | undefined;
	}>;
};

// Everything one scenario owns. Each scenario gets its own database and, when it needs one, its own API process, so
// scenarios never share state with each other or with the shared dev stack.
export const world: {
	// The scratch database of the scenario and the URL that reaches it.
	databaseName?: string;
	databaseUrl?: string;
	// The sale the steps talk about.
	saleId?: string;
	// A product a step made with SQL, for the sale that names it.
	productId?: string | undefined;
	// The message of the database error a step caught on purpose, which a Then step checks.
	failure?: string;
	// The cookie header of everyone who is logged in, by username. See auth.ts.
	logins?: Map<string, string>;
	// The cookie jar of the shopper in the auth scenarios, and a copy of it kept at one moment.
	jar?: Map<string, { value: string; path: string }>;
	jarCopy?: Map<string, { value: string; path: string }>;
	// The shoppers of the queue scenarios.
	queue?: ShopperState;
	// What the last run of seed-sale printed and how it exited.
	seed?: { status: number | null; stdout: string; stderr: string };
	// Settings for the private API, set by steps before it starts (for example a payment that declines). Set them through
	// the apiEnv setter below, which retires a running API.
	apiEnv?: Record<string, string>;
	// The private API that processes.ts started: its URL, its child process and what it printed.
	api?: { url: string; process: ChildProcess; log: string };
	// The Redis proxy the private API reaches Redis through, so a scenario can cut and restore the connection.
	redisProxy?: RedisProxy;
	// A confirmation that a step started and does not wait for, so another step can let it finish.
	pendingConfirm?: Promise<APIResponse>;
	// How long each confirmation took, in milliseconds.
	confirmMs?: number[];
	// Closes the event streams this scenario opened, before its API stops.
	streams?: Array<() => void>;
} = {};

// The settings of the private API. The API reads them once, when it starts, so a change after it started would do nothing.
// Setting a different value therefore stops the running API as a side effect (and closes its Redis proxy); the next
// request starts a new one with the new settings. The database is the scenario's own, so nothing the first one wrote is
// lost. Setting the same value again keeps the API running, so a web server pointed at it is not disturbed.
let apiEnvValue: Record<string, string> | undefined;
Object.defineProperty(world, "apiEnv", {
	enumerable: true,
	configurable: false,
	get: () => apiEnvValue,
	set: (value: Record<string, string> | undefined) => {
		const changed = JSON.stringify(value) !== JSON.stringify(apiEnvValue);
		apiEnvValue = value;
		const running = world.api;
		if (!running || !changed) return;
		delete world.api;
		running.process.kill("SIGTERM");
		const proxy = world.redisProxy;
		delete world.redisProxy;
		void proxy?.close();
	},
});

// Adds or changes some settings of the private API, and keeps the others. Goes through the apiEnv setter, so a running API
// is retired (see above).
export function setApiEnv(extra: Record<string, string>): void {
	world.apiEnv = { ...world.apiEnv, ...extra };
}

// Empties the state of the scenario, settings included, so the next scenario starts with the defaults.
export function forgetScenario(): void {
	apiEnvValue = undefined;
	for (const key of Object.keys(world) as Array<keyof typeof world>) {
		if (key !== "apiEnv") delete world[key];
	}
}

// The sale the scenario is about. A step that means "the sale" reads it here, so a scenario that has not made one fails
// with a clear message, instead of sending an empty id to the API and getting an unrelated 404.
export function currentSaleId(): string {
	if (world.saleId === undefined) {
		throw new Error(
			"no sale in this scenario: a Given step has to make one first",
		);
	}
	return world.saleId;
}
