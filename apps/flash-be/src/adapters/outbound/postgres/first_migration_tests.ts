// Unit test for the migration's up and down, run against a recording database, so it needs no Postgres.
import { expect, it } from "vitest";
import { recordingDb } from "../../../bdd/support/recording-db.js";
import { down, up } from "./migrations/0001_schema.js";

// The order the tables are dropped in: each one before the tables it refers to.
const DROP_ORDER = [
	"payments",
	"sessions",
	"reservations",
	"purchases",
	"sales",
	"products",
	"users",
];

// The shipped process only migrates upward, so the rollback is a developer detail, checked here.
it("creates the schema with the system user, and drops every table again in reverse order", async () => {
	const db = recordingDb();
	await up(db.db);
	await down(db.db);
	expect(db.queries.some((sql) => /create table "users"/.test(sql))).toBe(true);
	expect(db.queries.some((sql) => /insert into users/.test(sql))).toBe(true);
	const drops = db.queries.flatMap((sql) => {
		const table = /^drop table "(\w+)"$/.exec(sql)?.[1];
		return table === undefined ? [] : [table];
	});
	expect(drops).toEqual(DROP_ORDER);
});
