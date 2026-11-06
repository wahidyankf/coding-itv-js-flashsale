import { createHash, timingSafeEqual } from "node:crypto";

// The token of `Authorization: Bearer <token>`, or nothing when the header is missing or has another scheme.
export function bearerToken(header: string | undefined): string | undefined {
	return /^Bearer (\S+)$/i.exec(header ?? "")?.[1];
}

const digest = (value: string): Buffer =>
	createHash("sha256").update(value).digest();

// Both sides are hashed first, so the comparison takes the same time whatever the length or the content of the guess.
export function tokenMatches(expected: string, given: string): boolean {
	return timingSafeEqual(digest(expected), digest(given));
}
