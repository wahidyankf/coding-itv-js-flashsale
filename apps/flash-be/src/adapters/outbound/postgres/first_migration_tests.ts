import { expect, it } from "vitest";
import { recordingDb } from "../../../bdd/support/recording-db.js";
import { down, up } from "./migrations/0001_create_products.js";

// The first migration is only a step on the way to the latest schema. Its own rollback is a developer detail,
// so it is checked here.
it("creates the placeholder table and drops it again", async () => {
	const db = recordingDb();
	await up(db.db);
	await down(db.db);
	expect(db.queries.some((sql) => /create table "products"/.test(sql))).toBe(
		true,
	);
	expect(db.queries.some((sql) => /drop table "products"/.test(sql))).toBe(
		true,
	);
});
