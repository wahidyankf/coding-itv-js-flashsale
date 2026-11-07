// The random tokens of a login, from Node's crypto. Outbound adapter for the TokenSource port. A token is 32 random bytes
// in base64url, so it is safe in a cookie.
import { randomBytes } from "node:crypto";
import type { TokenSource } from "../../../application/ports/token-source.js";

const TOKEN_BYTES = 32;

// Random tokens for the running process. Each call draws fresh randomness, so no token can be guessed from another.
export const randomTokenSource: TokenSource = () =>
	randomBytes(TOKEN_BYTES).toString("base64url");
