import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

// The built API, started as its own process so that config is read at startup, as in production.
const ENTRY = path.resolve(process.cwd(), "../flash-be/dist/main.js");
const CONFIG_VARS = [
	"NODE_ENV",
	"DATABASE_URL",
	"REDIS_URL",
	"FLASH_BE_PORT",
	"FLASH_BE_HOST",
	"TICKET_SECRET",
	"ADMISSION_TICK_MS",
	"ADMISSION_TTL_SECONDS",
	"PAYMENT_LATENCY_MS",
	"PAYMENT_FAILURE_RATE",
];
const START_TIMEOUT_MS = 20_000;
const CONFIG_LINE = "flash-be config:";

let env: NodeJS.ProcessEnv = {};
let child: ChildProcess | undefined;
let stdout = "";
let stderr = "";
let exitCode: number | null | undefined;

// The environment of this run without the config variables, so each scenario sets its own.
function baseEnv(): NodeJS.ProcessEnv {
	const base: NodeJS.ProcessEnv = {};
	for (const [name, value] of Object.entries(process.env)) {
		if (value !== undefined && !CONFIG_VARS.includes(name)) base[name] = value;
	}
	return base;
}

// The startup line lists host and port only. Waiting for it works for valid and failing config alike.
function configLine(): string | undefined {
	return stdout.split("\n").find((line) => line.startsWith(CONFIG_LINE));
}

function field(name: string): RegExpMatchArray | null {
	const line = configLine();
	if (!line) throw new Error("flash-be did not print its config line");
	return line.match(new RegExp(`${name}=([^\\s]+)`));
}

async function startAndWait(): Promise<void> {
	const deadline = Date.now() + START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (exitCode !== undefined || configLine() !== undefined) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("flash-be neither printed its config nor exited in time");
}

const { Given, When, Then, After } = createBdd();

Given("NODE_ENV is not production", () => {
	env = { ...baseEnv(), NODE_ENV: "development" };
});

Given("NODE_ENV is production", () => {
	env = { ...baseEnv(), NODE_ENV: "production" };
});

Given("REDIS_URL is set", () => {
	env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

Given("DATABASE_URL is set", () => {
	env.DATABASE_URL =
		process.env.DATABASE_URL ?? "postgres://flash:flash@localhost:5432/flash";
});

Given(/^DATABASE_URL is "([^"]+)"$/, ({ request: _request }, url: string) => {
	env = { ...baseEnv(), DATABASE_URL: url };
});

Given(/^REDIS_URL is "([^"]+)"$/, ({ request: _request }, url: string) => {
	env.REDIS_URL = url;
});

Given(
	/^FLASH_BE_PORT is "([^"]*)"$/,
	async ({ request: _request }, value: string) => {
		env = { ...baseEnv(), FLASH_BE_PORT: value };
	},
);

Given(
	/^(ADMISSION_TICK_MS|ADMISSION_TTL_SECONDS|PAYMENT_LATENCY_MS|PAYMENT_FAILURE_RATE) is "([^"]*)"$/,
	async ({ request: _request }, name: string, value: string) => {
		env = { ...baseEnv(), [name]: value };
	},
);

When("the configuration is built", async () => {
	await startConfigured();
});

When("the configuration is built from an empty environment", async () => {
	await startConfigured();
});

async function startConfigured(): Promise<void> {
	stdout = "";
	stderr = "";
	exitCode = undefined;
	const started = spawn(process.execPath, [ENTRY], {
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	child = started;
	// Only the current process may change the state. A late event from the previous scenario's process must not
	// look like an exit of this one.
	started.stdout?.on("data", (chunk: Buffer) => {
		if (child === started) stdout += chunk.toString();
	});
	started.stderr?.on("data", (chunk: Buffer) => {
		if (child === started) stderr += chunk.toString();
	});
	started.on("exit", (code) => {
		if (child === started) exitCode = code;
	});
	await startAndWait();
}

Then(
	/^building the configuration fails with "([^"]+)"$/,
	async ({ request: _request }, message: string) => {
		expect(exitCode, "flash-be should exit").not.toBeUndefined();
		expect(exitCode).not.toBe(0);
		expect(stderr).toContain(message);
	},
);

Then(
	/^the payment takes (\d+) ms$/,
	async ({ request: _request }, ms: string) => {
		expect(field("payment")?.[1]?.split("/")[0]).toBe(`${ms}ms`);
	},
);

Then(
	/^the payment declines (\d+) percent of charges$/,
	async ({ request: _request }, percent: string) => {
		const rate = Number(field("payment")?.[1]?.split("/")[1]);
		expect(rate * 100).toBeCloseTo(Number(percent));
	},
);

Then(/^the port is (\d+)$/, async ({ request: _request }, port: string) => {
	expect(field("port")?.[1]).toBe(String(port));
});

Then(
	/^the database host is (\S+) on port (\d+)$/,
	async ({ request: _request }, host: string, port: string) => {
		expect(field("database")?.[1]).toBe(`${host}:${port}`);
	},
);

Then(
	/^the Redis host is (\S+) on port (\d+)$/,
	async ({ request: _request }, host: string, port: string) => {
		expect(field("redis")?.[1]).toBe(`${host}:${port}`);
	},
);

After(() => {
	if (child && child.exitCode === null && child.signalCode === null) {
		child.kill("SIGTERM");
	}
	child = undefined;
});
