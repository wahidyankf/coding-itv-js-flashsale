import { afterAll, beforeEach, expect, it } from "vitest";
import { resetSales } from "../../../bdd/support/seed.js";
import { config } from "../../../config.js";
import { hashToken, newToken } from "../../../domain/auth.js";
import { createDb } from "./database.js";
import { createSessionStore } from "./session-store.js";
import { ensureUser } from "./users.js";

// The branches of the session store that a scenario of a shopper does not reach by itself.
const db = createDb(config.databaseUrl);
const sessions = createSessionStore(db);

beforeEach(async () => {
	await resetSales(db);
});

afterAll(async () => {
	await db.destroy();
});

const HOUR_MS = 3_600_000;

it("does not rotate a refresh token that has ended, and ends nothing", async () => {
	const userId = await ensureUser(db, "ana");
	const refresh = newToken();
	const now = new Date();
	await sessions.create({
		userId,
		accessHash: hashToken(newToken()),
		accessExpiresAt: new Date(now.getTime() + HOUR_MS),
		refreshHash: hashToken(refresh),
		refreshExpiresAt: new Date(now.getTime() - HOUR_MS),
	});

	const rotated = await sessions.rotate({
		presentedRefreshHash: hashToken(refresh),
		accessHash: hashToken(newToken()),
		accessExpiresAt: new Date(now.getTime() + HOUR_MS),
		refreshHash: hashToken(newToken()),
		refreshExpiresAt: new Date(now.getTime() + HOUR_MS),
		now,
	});

	expect(rotated).toEqual({ principal: undefined, ended: [] });
});
