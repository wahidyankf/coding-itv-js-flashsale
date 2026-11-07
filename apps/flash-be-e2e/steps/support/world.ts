import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { type APIResponse, expect } from "@playwright/test";
import pg from "pg";
import type { PurchaseView, ReservedView } from "./views.js";

// The built API and its jobs, started as their own processes, as in production.
const DIST = path.resolve(process.cwd(), "../flash-be/dist");
const SERVER_URL =
	process.env.DATABASE_URL ?? "postgres://flash:flash@localhost:5432/flash";
// Redis index reserved for e2e processes started here. Index 15 is for integration tests, 0 for development.
export const E2E_REDIS_URL = (() => {
	const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
	url.pathname = "/14";
	return url.toString();
})();
const START_TIMEOUT_MS = 20_000;
// The user the migration made for the system, as SQL. Steps that write rows with SQL name it as their author.
export const SYSTEM_USER = "(select id from users where username = '$system')";
// The operator the scenarios log in as, made by the `create-operator` command, and the password of every account.
export const E2E_OPERATOR = "e2e-operator";
export const E2E_PASSWORD = "e2e long password";

// Everything one scenario owns. Each scenario gets its own database and, when it needs one, its own API
// process, so scenarios never share state with each other or with the shared dev stack.
export const world: {
	databaseName?: string;
	databaseUrl?: string;
	saleId?: string;
	// A product a step made with SQL, for the sale that names it.
	productId?: string | undefined;
	failure?: string;
	// The cookie header of everyone who is logged in, by name.
	logins?: Map<string, string>;
	// The cookie jar of the shopper in the auth scenarios, and a copy of it kept at one moment.
	jar?: Map<string, { value: string; path: string }>;
	jarCopy?: Map<string, { value: string; path: string }>;
	// What the shoppers of this scenario hold: their tickets, and who joined first.
	queue?: {
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
	seed?: { status: number | null; stdout: string; stderr: string };
	// Settings for the private API, set by steps before it starts (for example a payment that declines).
	apiEnv?: Record<string, string>;
	api?: { url: string; process: ChildProcess; log: string };
	// The private API reaches Redis through this proxy, so a scenario can cut and restore the connection.
	redisProxy?: RedisProxy;
	pendingConfirm?: Promise<APIResponse>;
	// How long each confirmation took, in milliseconds.
	confirmMs?: number[];
	// Closes the event streams this scenario opened, before its API stops.
	streams?: Array<() => void>;
} = {};

// Changing the settings of the private API after it started would change nothing, because it reads them once. A sale
// is now made through the API, which starts it early, so a later step that sets a payment, a limit or a cache would be
// ignored. Setting `apiEnv` therefore retires a running API; the next request starts a new one with the new settings.
// The database is the scenario's own, so nothing the first one wrote is lost.
let apiEnvValue: Record<string, string> | undefined;
Object.defineProperty(world, "apiEnv", {
	enumerable: true,
	configurable: false,
	get: () => apiEnvValue,
	set: (value: Record<string, string> | undefined) => {
		const changed = JSON.stringify(value) !== JSON.stringify(apiEnvValue);
		apiEnvValue = value;
		const running = world.api;
		// Setting what is already set must not stop the API a web server is pointed at.
		if (!running || !changed) return;
		delete world.api;
		running.process.kill("SIGTERM");
		const proxy = world.redisProxy;
		delete world.redisProxy;
		void proxy?.close();
	},
});

// A TCP relay in front of Redis. `down` drops every connection and refuses new ones, as an unreachable Redis does;
// `up` accepts again on the same port. The data in Redis is not touched.
export type RedisProxy = {
	url: string;
	down: () => Promise<void>;
	up: () => Promise<void>;
	close: () => Promise<void>;
};

async function startRedisProxy(target: string): Promise<RedisProxy> {
	const to = new URL(target);
	const sockets = new Set<net.Socket>();
	const relay = (client: net.Socket) => {
		const upstream = net.connect(Number(to.port || 6379), to.hostname);
		for (const socket of [client, upstream]) {
			sockets.add(socket);
			socket.on("error", () => socket.destroy());
			socket.on("close", () => {
				sockets.delete(socket);
				client.destroy();
				upstream.destroy();
			});
		}
		client.pipe(upstream);
		upstream.pipe(client);
	};
	const listen = (port: number) =>
		new Promise<net.Server>((resolve, reject) => {
			const server = net.createServer(relay);
			server.once("error", reject);
			server.listen(port, "127.0.0.1", () => resolve(server));
		});
	let server = await listen(0);
	const port = (server.address() as net.AddressInfo).port;
	const stop = () =>
		new Promise<void>((resolve) => {
			for (const socket of sockets) socket.destroy();
			server.close(() => resolve());
		});
	const url = new URL(target);
	url.hostname = "127.0.0.1";
	url.port = String(port);
	return {
		url: url.toString(),
		down: stop,
		up: async () => {
			server = await listen(port);
		},
		close: stop,
	};
}

function childEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [name, value] of Object.entries(process.env)) {
		if (value !== undefined && name !== "NODE_ENV") env[name] = value;
	}
	return { ...env, ...extra };
}

export async function createScratchDatabase(): Promise<void> {
	const name = `flash_e2e_${randomUUID().replaceAll("-", "_")}`;
	const admin = new pg.Client({ connectionString: SERVER_URL });
	await admin.connect();
	await admin.query(`create database "${name}"`);
	await admin.end();
	const url = new URL(SERVER_URL);
	url.pathname = `/${name}`;
	world.databaseName = name;
	world.databaseUrl = url.toString();
}

export function migrate(): void {
	const run = spawnSync(process.execPath, [path.join(DIST, "migrate.js")], {
		env: childEnv({ DATABASE_URL: world.databaseUrl }),
		encoding: "utf8",
	});
	expect(run.status, run.stderr).toBe(0);
}

export async function migratedDatabase(): Promise<void> {
	await createScratchDatabase();
	migrate();
}

export function seed(args: string[]): void {
	const run = spawnSync(
		process.execPath,
		[path.join(DIST, "seed-sale.js"), ...args],
		{
			env: childEnv({ DATABASE_URL: world.databaseUrl }),
			encoding: "utf8",
		},
	);
	world.seed = { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

// Makes an operator account the way a deployment does, with the command, because the API cannot sign one up.
export function createOperator(username: string, password: string): void {
	const run = spawnSync(
		process.execPath,
		[
			path.join(DIST, "create-operator.js"),
			"--username",
			username,
			"--password",
			password,
		],
		{
			env: childEnv({ DATABASE_URL: world.databaseUrl }),
			encoding: "utf8",
		},
	);
	expect(run.status, run.stderr).toBe(0);
}

export async function query<T>(
	sql: string,
	params: unknown[] = [],
): Promise<T[]> {
	const client = new pg.Client({ connectionString: world.databaseUrl });
	await client.connect();
	try {
		return (await client.query(sql, params)).rows as T[];
	} finally {
		await client.end();
	}
}

async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as net.AddressInfo;
			server.close(() => resolve(port));
		});
	});
}

// Starts a private API on a free port, over this scenario's database, and waits for /health.
export async function startApi(): Promise<string> {
	if (world.api) return world.api.url;
	const port = await freePort();
	world.redisProxy = await startRedisProxy(E2E_REDIS_URL);
	const child = spawn(process.execPath, [path.join(DIST, "main.js")], {
		env: childEnv({
			DATABASE_URL: world.databaseUrl,
			REDIS_URL: world.redisProxy.url,
			FLASH_BE_PORT: String(port),
			FLASH_BE_HOST: "127.0.0.1",
			// Instant and never declined, unless a step says otherwise. The default 2 percent would flake scenarios.
			PAYMENT_LATENCY_MS: "0",
			PAYMENT_FAILURE_RATE: "0",
			// Limits out of reach, unless a step sets them.
			RATE_LIMIT_WINDOW_SECONDS: "60",
			RATE_LIMIT_PER_USER: "100000",
			RATE_LIMIT_PER_IP: "100000",
			AUTH_RATE_LIMIT_PER_IP: "100000",
			// No sale cache, unless a step turns it on, so a scenario always reads the sale as it is.
			SALE_CACHE_MS: "0",
			// Event streams read often, so a scenario sees a change within a moment.
			EVENTS_INTERVAL_MS: "100",
			// The e2e API runs on plain HTTP, which cannot carry Secure cookies.
			COOKIE_SECURE: "false",
			...world.apiEnv,
		}),
		stdio: ["ignore", "pipe", "pipe"],
	});
	const url = `http://127.0.0.1:${port}`;
	const api = { url, process: child, log: "" };
	world.api = api;
	// The log is where the mock payment records a refund. Reading it also keeps the pipe from filling up.
	child.stdout?.on("data", (chunk: Buffer) => {
		api.log += chunk.toString();
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		api.log += chunk.toString();
	});

	const deadline = Date.now() + START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error("flash-be exited at start");
		try {
			if ((await fetch(`${url}/health`)).ok) return url;
		} catch {
			// not listening yet
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("flash-be did not answer /health in time");
}

// Stops the private API and drops the scenario's database. Runs after every scenario.
export async function cleanup(): Promise<void> {
	for (const close of world.streams ?? []) close();
	const api = world.api;
	if (api && api.process.exitCode === null) {
		const exited = new Promise((resolve) => api.process.once("exit", resolve));
		api.process.kill("SIGTERM");
		await exited;
	}
	await world.redisProxy?.close();
	if (world.databaseName) {
		const admin = new pg.Client({ connectionString: SERVER_URL });
		await admin.connect();
		await admin.query(
			`drop database if exists "${world.databaseName}" with (force)`,
		);
		await admin.end();
	}
	apiEnvValue = undefined;
	for (const key of Object.keys(world) as Array<keyof typeof world>) {
		if (key !== "apiEnv") delete world[key];
	}
}
