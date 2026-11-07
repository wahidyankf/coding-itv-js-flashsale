// The Postgres of the e2e scenarios. Each scenario gets a scratch database, built by the real migrations, and the steps
// reach it through `query`, the commands that set it up, and the SQL helpers. cleanup.ts drops it after the scenario.

import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import pg from "pg";
import { runScript } from "./processes.js";
import { world } from "./world.js";

// The Postgres server the scratch databases are made on. Its user must be allowed to create and drop databases.
const SERVER_URL =
	process.env.DATABASE_URL ?? "postgres://flash:flash@localhost:5432/flash";
// The user the migration made for the system, as SQL. Steps that write rows with SQL name it as their author.
export const SYSTEM_USER = "(select id from users where username = '$system')";

// Runs one statement on the database at `url` and returns its rows. The connection is opened for this call only.
async function runSql<T>(
	url: string | undefined,
	sql: string,
	params: unknown[] = [],
): Promise<T[]> {
	const client = new pg.Client({ connectionString: url });
	await client.connect();
	try {
		return (await client.query(sql, params)).rows as T[];
	} finally {
		await client.end();
	}
}

// Makes an empty database with a random name on the server, and points the scenario at it. The migrations run next.
export async function createScratchDatabase(): Promise<void> {
	const name = `flash_e2e_${randomUUID().replaceAll("-", "_")}`;
	await runSql(SERVER_URL, `create database "${name}"`);
	const url = new URL(SERVER_URL);
	url.pathname = `/${name}`;
	world.databaseName = name;
	world.databaseUrl = url.toString();
}

// Drops a scratch database and any connection still open to it. Called by cleanup.ts after each scenario.
export async function dropScratchDatabase(name: string): Promise<void> {
	await runSql(SERVER_URL, `drop database if exists "${name}" with (force)`);
}

// Runs the migrations on the scenario's database, as a deployment does. The step fails if they do not finish.
export function migrate(): void {
	const run = runScript("migrate.js", []);
	expect(run.status, run.stderr).toBe(0);
}

// A scratch database with the migrations applied: the starting point of most scenarios.
export async function migratedDatabase(): Promise<void> {
	await createScratchDatabase();
	migrate();
}

// Makes the scratch database the first time a step needs it. Steps that touch the database call this first.
export async function ensureDatabase(): Promise<void> {
	if (!world.databaseUrl) await migratedDatabase();
}

// Runs seed-sale with these arguments. The result is kept in world.seed, because some scenarios expect a failing run.
export function seed(args: string[]): void {
	const run = runScript("seed-sale.js", args);
	world.seed = { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

// Makes an operator account the way a deployment does: with the command, because the API cannot sign an operator up.
export function createOperator(username: string, password: string): void {
	const run = runScript("create-operator.js", [
		"--username",
		username,
		"--password",
		password,
	]);
	expect(run.status, run.stderr).toBe(0);
}

// Runs a statement on the scenario's database and returns its rows, for the steps that check or change the rows directly.
export function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
	return runSql<T>(world.databaseUrl, sql, params);
}

// Inserts a sale with a product of its own, with SQL. Only for states real traffic cannot reach: more items sold than
// stock, or items sold before the sale opens. Returns the sale's id.
export async function insertSale(sale: {
	name: string;
	startsAt: Date;
	endsAt: Date;
	stock: number;
	sold: number;
}): Promise<string> {
	const rows = await query<{ id: string }>(
		`with product as (
		   insert into products (name, created_by) values ($1, ${SYSTEM_USER}) returning id
		 )
		 insert into sales (product_id, name, starts_at, ends_at, stock, sold, created_by)
		 select product.id, $1, $2, $3, $4, $5, ${SYSTEM_USER} from product returning id`,
		[sale.name, sale.startsAt, sale.endsAt, sale.stock, sale.sold],
	);
	const id = rows[0]?.id;
	if (!id) throw new Error("the sale was not inserted");
	return id;
}
