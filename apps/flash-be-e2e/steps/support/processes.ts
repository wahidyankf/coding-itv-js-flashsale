// The processes a scenario runs: the private flash-be API (its built output, as in production), the Redis proxy in front of
// it, the built scripts that work on the scenario's database, and the Redis client the steps use to change what the API
// reads. Nothing here decides what a scenario expects; that is in the steps.

import { type SpawnSyncReturns, spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { createClient } from "redis";
import { pipeSockets } from "./relay.js";
import { pollUntil } from "./time.js";
import { type RedisProxy, world } from "./world.js";

// A connected client. Its type is taken from this function, so the steps get exactly what createClient returns.
async function connect(url: string) {
	const client = createClient({ url });
	await client.connect();
	return client;
}
type RedisClient = Awaited<ReturnType<typeof connect>>;

// The built API and its scripts, run as their own processes, as in production.
const DIST = path.resolve(process.cwd(), "../flash-be/dist");
// The Redis of the dev stack. The e2e processes use another index of the same server, below.
export const DEV_REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
// Redis index 14 is reserved for the e2e processes. Index 15 is for the integration tests and 0 for development.
export const E2E_REDIS_URL = (() => {
	const url = new URL(DEV_REDIS_URL);
	url.pathname = "/14";
	return url.toString();
})();
const START_TIMEOUT_MS = 20_000;
const HEALTH_POLL_MS = 100;
const DEFAULT_REDIS_PORT = 6379;

// The settings of the private API unless a step sets others. Each one keeps a scenario deterministic: no payment is
// declined, no limit is reached, and nothing is cached.
const API_DEFAULTS: Record<string, string> = {
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
};

// The environment of a child process: this process's own variables, without NODE_ENV, with `extra` on top.
function childEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [name, value] of Object.entries(process.env)) {
		if (value !== undefined && name !== "NODE_ENV") env[name] = value;
	}
	return { ...env, ...extra };
}

// Runs one of the built scripts of flash-be against the scenario's database, and waits for it to finish. Returns its output
// and exit status, so the caller decides whether a failure is the expected outcome.
export function runScript(
	script: string,
	args: string[],
): SpawnSyncReturns<string> {
	return spawnSync(process.execPath, [path.join(DIST, script), ...args], {
		env: childEnv({ DATABASE_URL: world.databaseUrl }),
		encoding: "utf8",
	});
}

// A TCP relay in front of Redis. `down` drops every connection and refuses new ones, `up` accepts again on the same port.
async function startRedisProxy(target: string): Promise<RedisProxy> {
	const to = new URL(target);
	const sockets = new Set<net.Socket>();
	const relay = (client: net.Socket) => {
		pipeSockets(
			client,
			net.connect(Number(to.port || DEFAULT_REDIS_PORT), to.hostname),
			sockets,
		);
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

// A port nobody listens on, found by letting the system pick one and then giving it back.
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

// Starts the private API on a free port, over this scenario's database and through its Redis proxy, and waits until
// /health answers. Returns its URL. A running API is reused, so a step may call this as often as it needs.
export async function startApi(): Promise<string> {
	if (world.api) return world.api.url;
	const port = await freePort();
	world.redisProxy = await startRedisProxy(E2E_REDIS_URL);
	const child = spawn(process.execPath, [path.join(DIST, "main.js")], {
		env: childEnv({
			...API_DEFAULTS,
			DATABASE_URL: world.databaseUrl,
			REDIS_URL: world.redisProxy.url,
			FLASH_BE_PORT: String(port),
			FLASH_BE_HOST: "127.0.0.1",
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

	await pollUntil(
		async () => {
			if (child.exitCode !== null) throw new Error("flash-be exited at start");
			try {
				return (await fetch(`${url}/health`)).ok;
			} catch {
				// not listening yet
				return false;
			}
		},
		{
			withinMs: START_TIMEOUT_MS,
			everyMs: HEALTH_POLL_MS,
			failure: "flash-be did not answer /health in time",
		},
	);
	return url;
}

// Stops the scenario's API and waits for it to exit, then closes its Redis proxy. Does nothing when no API runs.
export async function stopApi(): Promise<void> {
	const api = world.api;
	if (api && api.process.exitCode === null) {
		const exited = new Promise((resolve) => api.process.once("exit", resolve));
		api.process.kill("SIGTERM");
		await exited;
	}
	await world.redisProxy?.close();
}

// Runs `run` on a Redis client connected to `url`, and closes the client afterwards, even when `run` throws.
export async function withRedis<T>(
	url: string,
	run: (redis: RedisClient) => Promise<T>,
): Promise<T> {
	const redis = await connect(url);
	try {
		return await run(redis);
	} finally {
		await redis.close();
	}
}
