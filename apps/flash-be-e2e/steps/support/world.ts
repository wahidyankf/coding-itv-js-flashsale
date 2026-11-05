import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { expect } from "@playwright/test";
import pg from "pg";

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

// Everything one scenario owns. Each scenario gets its own database and, when it needs one, its own API
// process, so scenarios never share state with each other or with the shared dev stack.
export const world: {
	databaseName?: string;
	databaseUrl?: string;
	saleId?: string;
	failure?: string;
	// What the shoppers of this scenario hold: their tickets, and who joined first.
	queue?: {
		tickets: Map<string, string>;
		joined: string[];
		holds: Map<string, unknown>;
		replies: Array<{ status: number; error?: string }>;
	};
	seed?: { status: number | null; stdout: string; stderr: string };
	api?: { url: string; process: ChildProcess };
} = {};

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
	const child = spawn(process.execPath, [path.join(DIST, "main.js")], {
		env: childEnv({
			DATABASE_URL: world.databaseUrl,
			REDIS_URL: E2E_REDIS_URL,
			FLASH_BE_PORT: String(port),
			FLASH_BE_HOST: "127.0.0.1",
		}),
		stdio: "ignore",
	});
	const url = `http://127.0.0.1:${port}`;
	world.api = { url, process: child };

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
	const api = world.api;
	if (api && api.process.exitCode === null) {
		const exited = new Promise((resolve) => api.process.once("exit", resolve));
		api.process.kill("SIGTERM");
		await exited;
	}
	if (world.databaseName) {
		const admin = new pg.Client({ connectionString: SERVER_URL });
		await admin.connect();
		await admin.query(
			`drop database if exists "${world.databaseName}" with (force)`,
		);
		await admin.end();
	}
	for (const key of Object.keys(world) as Array<keyof typeof world>) {
		delete world[key];
	}
}
