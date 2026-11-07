import { Ok } from "@flash/typekit";
import { afterAll, describe, expect, it } from "vitest";
import { config } from "../../../config.js";
import { createDb } from "./database.js";
import { createPostgresSaleAdmin } from "./sale-admin.js";

// The paths a scenario cannot reach: a sale that is not there, against the real tables.
const db = createDb(config.databaseUrl);
const admin = createPostgresSaleAdmin(db);
const MISSING = "00000000-0000-4000-8000-000000000000";

afterAll(async () => {
	await db.destroy();
});

describe("changing and removing a sale that is not there", () => {
	it("refuses a change with `sale_not_found`, without asking `decide`", async () => {
		let asked = false;
		const changed = await admin.update(MISSING, (current) => {
			asked = true;
			return new Ok(current);
		});
		expect(changed.isErr() && changed.error).toBe("sale_not_found");
		expect(asked).toBe(false);
	});

	it("refuses a removal with `sale_not_found`", async () => {
		const removed = await admin.remove(MISSING);
		expect(removed.isErr() && removed.error).toBe("sale_not_found");
	});
});
