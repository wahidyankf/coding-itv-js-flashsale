import { MS_PER_HOUR } from "@flash/flash-commons";
import { sql } from "kysely";
import { afterAll, beforeEach, expect, it } from "vitest";
import { resetSales } from "../../../bdd/support/seed.js";
import { config } from "../../../config.js";
import { hashToken } from "../../../domain/auth.js";
import { userIdOf } from "../../../domain/user.js";
import { randomTokenSource } from "../crypto/token-source.js";
import { createDb } from "./database.js";
import { createSessionStore } from "./session-store.js";
import { ensureUser } from "./users.js";

// The branches of the session store that a scenario of a shopper does not reach by itself.
const db = createDb(config.databaseUrl);
const sessions = createSessionStore(db);

// The end time of a token that lasts an hour from `from`.
const anHourFrom = (from: Date) => new Date(from.getTime() + MS_PER_HOUR);

// A login for this user whose access and refresh tokens both last an hour. Returns the raw tokens the shopper keeps.
async function openLogin(userId: string, now: Date) {
	const access = hashToken(randomTokenSource());
	const refresh = randomTokenSource();
	await sessions.create({
		userId: userIdOf(userId),
		accessHash: access,
		accessExpiresAt: anHourFrom(now),
		refreshHash: hashToken(refresh),
		refreshExpiresAt: anHourFrom(now),
	});
	return { access, refresh };
}

beforeEach(async () => {
	await resetSales(db);
});

afterAll(async () => {
	await db.destroy();
});

it("does not rotate a refresh token that has ended, and ends nothing", async () => {
	const userId = await ensureUser(db, "ana");
	const refresh = randomTokenSource();
	const now = new Date();
	await sessions.create({
		userId: userIdOf(userId),
		accessHash: hashToken(randomTokenSource()),
		accessExpiresAt: new Date(now.getTime() + MS_PER_HOUR),
		refreshHash: hashToken(refresh),
		refreshExpiresAt: new Date(now.getTime() - MS_PER_HOUR),
	});

	const rotated = await sessions.rotate({
		presentedRefreshHash: hashToken(refresh),
		accessHash: hashToken(randomTokenSource()),
		accessExpiresAt: new Date(now.getTime() + MS_PER_HOUR),
		refreshHash: hashToken(randomTokenSource()),
		refreshExpiresAt: new Date(now.getTime() + MS_PER_HOUR),
		now,
	});

	expect(rotated).toEqual({ principal: undefined, ended: [] });
});

it("gives no user, and ends the old access token, when the user of the session has been removed", async () => {
	const userId = await ensureUser(db, "ben");
	const now = new Date();
	const login = await openLogin(userId, now);
	await sql`update users set deleted_at = now() where id = ${userId}`.execute(
		db,
	);

	const rotated = await sessions.rotate({
		presentedRefreshHash: hashToken(login.refresh),
		accessHash: hashToken(randomTokenSource()),
		accessExpiresAt: anHourFrom(now),
		refreshHash: hashToken(randomTokenSource()),
		refreshExpiresAt: anHourFrom(now),
		now,
	});

	expect(rotated).toEqual({ principal: undefined, ended: [login.access] });
});

it("ends nothing when a refresh token matches no session at all", async () => {
	const now = new Date();
	const rotated = await sessions.rotate({
		presentedRefreshHash: hashToken(randomTokenSource()),
		accessHash: hashToken(randomTokenSource()),
		accessExpiresAt: anHourFrom(now),
		refreshHash: hashToken(randomTokenSource()),
		refreshExpiresAt: anHourFrom(now),
		now,
	});

	expect(rotated).toEqual({ principal: undefined, ended: [] });
});

it("revokes the login of a refresh token alone, and returns the access hash it had", async () => {
	const userId = await ensureUser(db, "cara");
	const now = new Date();
	const login = await openLogin(userId, now);

	const ended = await sessions.revoke({
		refreshHash: hashToken(login.refresh),
	});

	expect(ended).toEqual([login.access]);
	expect(await sessions.findByAccess(login.access, now)).toBeUndefined();
});

it("revokes the login of an access token alone", async () => {
	const userId = await ensureUser(db, "dan");
	const now = new Date();
	const login = await openLogin(userId, now);

	const ended = await sessions.revoke({ accessHash: login.access });

	expect(ended).toEqual([login.access]);
	expect(await sessions.findByAccess(login.access, now)).toBeUndefined();
});
