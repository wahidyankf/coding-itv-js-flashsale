// Unit test for the first migration's up and down, run against a recording database, so it needs no Postgres.
import { expect, it } from "vitest";
import { recordingDb } from "../../../bdd/support/recording-db.js";
import { down, up } from "./migrations/0001_users.js";

// The first migration is only a step on the way to the latest schema. Its own rollback is a developer detail,
// so it is checked here.
it("creates the users table with the system user and drops it again", async () => {
	const db = recordingDb();
	await up(db.db);
	await down(db.db);
	expect(db.queries.some((sql) => /create table "users"/.test(sql))).toBe(true);
	expect(db.queries.some((sql) => /insert into users/.test(sql))).toBe(true);
	expect(db.queries.some((sql) => /drop table "users"/.test(sql))).toBe(true);
});
