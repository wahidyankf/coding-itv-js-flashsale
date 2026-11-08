// The auth steps' unit layer: the accounts and logins live in memory, the app is built on them, and the clock is one the
// scenario moves. Only the auth steps use it; the app is closed by the test file that made it.
import { MS_PER_MINUTE } from "@flash/flash-commons";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../adapters/inbound/http/app.js";
import { createScryptHasher } from "../../adapters/outbound/crypto/scrypt-hasher.js";
import { authWorld } from "./auth-world.js";
import { healthyDeps } from "./deps.js";
import { memoryAuth } from "./memory-auth.js";

// Past the 15 minutes of an access token.
const PAST_ACCESS_MS = 16 * MS_PER_MINUTE;

// One scenario in memory: its accounts, logins and clock. The app goes into `apps`, so the test file can close it.
export function unitAuthWorld(apps: FastifyInstance[]) {
	let now = new Date("2026-06-01T12:00:00Z");
	const auth = memoryAuth(() => now, createScryptHasher());
	const app = buildApp(
		{ ...healthyDeps, auth: auth.service },
		{ cookieSecure: false },
	);
	apps.push(app);
	return authWorld({
		app: () => app,
		expireAccess: async () => {
			now = new Date(now.getTime() + PAST_ACCESS_MS);
		},
		stored: async () => auth.stored(),
	});
}
