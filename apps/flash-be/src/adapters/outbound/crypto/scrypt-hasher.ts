// The password hasher, with scrypt from Node itself, so there is no package to keep up to date. Outbound adapter for the
// PasswordHasher port. The cost is the default of Node (N = 16384): it takes tens of milliseconds, which is the point of
// it. The text stored is `scrypt$<salt>$<key>`, both parts in base64.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { PasswordHasher } from "../../../application/ports/password-hasher.js";

const SALT_BYTES = 16;
const KEY_BYTES = 64;
const SCHEME = "scrypt";

const scryptAsync = promisify<string, Buffer, number, Buffer>(scrypt);
const derive = (password: string, salt: Buffer): Promise<Buffer> =>
	scryptAsync(password, salt, KEY_BYTES);

// Hashes passwords and checks them. `verify` derives the key again and compares it in constant time, so the answer does
// not leak through timing.
export function createScryptHasher(): PasswordHasher {
	return {
		async hash(password) {
			const salt = randomBytes(SALT_BYTES);
			const key = await derive(password, salt);
			return `${SCHEME}$${salt.toString("base64")}$${key.toString("base64")}`;
		},
		async verify(password, stored) {
			const [scheme, salt, key] = stored.split("$");
			if (scheme !== SCHEME || salt === undefined || key === undefined) {
				return false;
			}
			const expected = Buffer.from(key, "base64");
			const given = await derive(password, Buffer.from(salt, "base64"));
			return (
				expected.length === given.length && timingSafeEqual(expected, given)
			);
		},
	};
}
