import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect } from "@playwright/test";
import pg from "pg";
import { createBdd } from "playwright-bdd";

// The built migrate job, run as its own process against a scratch database, as the compose job does.
const MIGRATE = path.resolve(process.cwd(), "../flash-be/dist/migrate.js");
const SERVER_URL =
	process.env.DATABASE_URL ?? "postgres://flash:flash@localhost:5432/flash";

let databaseName: string | undefined;
let databaseUrl: string | undefined;

async function createScratchDatabase(): Promise<void> {
	databaseName = `flash_e2e_${randomUUID().replaceAll("-", "_")}`;
	const admin = new pg.Client({ connectionString: SERVER_URL });
	await admin.connect();
	await admin.query(`create database "${databaseName}"`);
	await admin.end();
	const url = new URL(SERVER_URL);
	url.pathname = `/${databaseName}`;
	databaseUrl = url.toString();
}

function runMigrations(): void {
	const run = spawnSync(process.execPath, [MIGRATE], {
		env: { ...process.env, DATABASE_URL: databaseUrl },
		encoding: "utf8",
	});
	expect(run.status, run.stderr).toBe(0);
}

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
	const client = new pg.Client({ connectionString: databaseUrl });
	await client.connect();
	try {
		return (await client.query(sql, params)).rows as T[];
	} finally {
		await client.end();
	}
}

const { Given, When, Then, After } = createBdd();

Given("a database with no tables", async () => {
	await createScratchDatabase();
});

Given("a database migrated to the latest version", async () => {
	await createScratchDatabase();
	runMigrations();
});

When("the migrations run to the latest version", () => {
	runMigrations();
});

Then("the products table exists", async () => {
	const rows = await query<{ name: string | null }>(
		"select to_regclass('public.products') as name",
	);
	expect(rows[0]?.name).toBe("products");
});

// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
When(/^a product named "([^"]+)" is seeded$/, async ({}, name: string) => {
	await query("insert into products (name) values ($1)", [name]);
});

Then("the products table holds 1 product", async () => {
	const rows = await query<{ count: number }>(
		"select count(*)::int as count from products",
	);
	expect(rows[0]?.count).toBe(1);
});

After(async () => {
	if (!databaseName) return;
	const admin = new pg.Client({ connectionString: SERVER_URL });
	await admin.connect();
	await admin.query(`drop database if exists "${databaseName}" with (force)`);
	await admin.end();
	databaseName = undefined;
	databaseUrl = undefined;
});
