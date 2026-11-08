// Unit tests for logged-rebuild.ts: a rebuild of the sale gate is logged when it starts and when it is done, a failed one
// is logged and still fails, and the other calls pass through unchanged.
import { describe, expect, it } from "vitest";
import type { LogFields } from "../../../application/ports/logger.js";
import type { ReservationRepository } from "../../../application/ports/reservation-repository.js";
import { usernameOf } from "../../../bdd/support/users.js";
import { withRebuildLog } from "./logged-rebuild.js";

function recording() {
	const lines: Array<{ level: string; message: string; fields: LogFields }> =
		[];
	const at =
		(level: string) =>
		(fields: LogFields, message: string): void => {
			lines.push({ level, message, fields });
		};
	return {
		lines,
		log: {
			debug: at("debug"),
			info: at("info"),
			warn: at("warn"),
			error: at("error"),
		},
	};
}

// A repository whose rebuild runs `rebuild` and whose other calls answer at once.
function repository(
	rebuild: ReservationRepository["rebuild"],
): ReservationRepository {
	return {
		hasPurchase: async () => true,
		save: async () => {},
		reserveWithoutGate: async () => ({ kind: "sold_out" }) as never,
		rebuild,
	};
}

describe("withRebuildLog", () => {
	it("logs the start and the end of a rebuild, with the sale", async () => {
		const { lines, log } = recording();
		const order: string[] = [];
		const logged = withRebuildLog(
			repository(async () => {
				order.push(`rebuilt with ${lines.length} line`);
			}),
			log,
		);
		await logged.rebuild("sale-1", new Date(), async () => {});
		expect(order).toEqual(["rebuilt with 1 line"]);
		expect(lines).toEqual([
			{
				level: "info",
				message: "sale gate rebuild started",
				fields: { saleId: "sale-1" },
			},
			{
				level: "info",
				message: "sale gate rebuild done",
				fields: { saleId: "sale-1" },
			},
		]);
	});

	it("logs a rebuild that fails, and lets the failure reach the caller", async () => {
		const { lines, log } = recording();
		const broken = new Error("postgres is down");
		const logged = withRebuildLog(
			repository(async () => {
				throw broken;
			}),
			log,
		);
		await expect(
			logged.rebuild("sale-1", new Date(), async () => {}),
		).rejects.toBe(broken);
		expect(lines.at(-1)).toEqual({
			level: "warn",
			message: "sale gate rebuild failed",
			fields: { saleId: "sale-1", cause: "postgres is down" },
		});
	});

	it("passes the other calls through", async () => {
		const { lines, log } = recording();
		const logged = withRebuildLog(
			repository(async () => {}),
			log,
		);
		expect(await logged.hasPurchase("sale-1", usernameOf("ana"))).toBe(true);
		expect(lines).toEqual([]);
	});
});
