// The readiness check of Postgres (outbound Postgres adapter). `/ready` reports it, through the dependency the composition
// wires. A bare `select 1` is enough: the question is whether the database answers, not what it holds.
import { type Kysely, sql } from "kysely";
import type { Database } from "./database.js";

// Resolves when the database answers, and rejects when it does not.
export async function checkDatabase(db: Kysely<Database>): Promise<void> {
	await sql`select 1`.execute(db);
}
