// The command's database, opened and closed around its work. The pool connects only when a query runs, so these tests
// need no server: they check what the work gets back, and that a failure of the work reaches the caller unchanged.
import { describe, expect, it } from "vitest";
import { withDb } from "./with-db.js";

const URL = "postgres://flash:flash@localhost:5432/flash";

describe("withDb", () => {
	it("returns what the work returns", async () => {
		await expect(withDb(URL, async () => "done")).resolves.toBe("done");
	});

	it("lets a failure of the work reach the caller unchanged", async () => {
		await expect(
			withDb(URL, async () => {
				throw new Error("the work failed");
			}),
		).rejects.toThrow("the work failed");
	});
});
