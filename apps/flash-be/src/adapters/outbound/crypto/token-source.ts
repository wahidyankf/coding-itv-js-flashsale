// The random tokens of a login, from Node's crypto. A token is 32 random bytes in base64url, so it is safe in a cookie.
import { randomBytes } from "node:crypto";
import type { TokenSource } from "../../../application/ports/token-source.js";

const TOKEN_BYTES = 32;

// The production token source. Each call reads fresh randomness.
export const randomTokenSource: TokenSource = () =>
	randomBytes(TOKEN_BYTES).toString("base64url");
