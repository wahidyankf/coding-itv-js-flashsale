// The accounts of a load run: the user name and address of each one, the file the runner writes their tokens to, and the
// reading of that file. The runner signs the accounts up before k6 starts, so no shopper signs up during the sale; the
// k6 script only reads the tokens. Pure: no I/O and no k6 module, so the runner and the bundled script share it.

import { attempt } from "@flash/typekit";
import type { Profile } from "./profiles.ts";

// The password of every load account. The accounts exist only in this test stack, so the password guards nothing.
export const PASSWORD = "load-test-password";
// The cookie that carries the access token. The API's name is written here, so a renamed cookie fails the test.
export const ACCESS_COOKIE = "access_token";

// One account: the user name it signs up with, and the address its requests come from.
export type Account = { user: string; ip: string };

// How many accounts of each kind a run signs up.
export type AccountCounts = Pick<
	Profile,
	"users" | "latecomers" | "hammerUsers"
>;

// Latecomers get addresses far from the shoppers' range, so the two never share one.
const LATECOMER_ID_OFFSET = 1_000_000;
// An IPv4 address is four bytes; an index is spread over the last three of them.
const BYTE = 255;
const BYTE_BITS = 8;
// The documentation range (192.0.2.0/24) is where the hammer's addresses are, apart from the shoppers' range.
const HAMMER_PREFIX = "192.0.2";

// The numbers 1 to count, in order.
function countUp(count: number): number[] {
	return Array.from({ length: count }, (_, index) => index + 1);
}

// The address of an index. Every shopper has their own, so the API limits each of them on their own.
function addressOf(index: number): string {
	return `10.${(index >> (BYTE_BITS * 2)) & BYTE}.${(index >> BYTE_BITS) & BYTE}.${index & BYTE}`;
}

// The shopper with this index (from 1).
export function shopperAccount(index: number): Account {
	return { user: `shopper-${index}`, ip: addressOf(index) };
}

// The latecomer with this index (from 1). Latecomers never share an address with a shopper.
export function latecomerAccount(index: number): Account {
	return {
		user: `late-${index}`,
		ip: addressOf(LATECOMER_ID_OFFSET + index),
	};
}

// The hammer with this id (from 1). Each hammer has its own address, so its flood is limited on its own.
export function hammerAccount(id: number): Account {
	return { user: `hammer-${id}`, ip: `${HAMMER_PREFIX}.${id}` };
}

// Every account a run signs up, in order: the shoppers, the latecomers, then the hammers.
export function accountsOf(counts: AccountCounts): Account[] {
	return [
		...countUp(counts.users).map((index) => shopperAccount(index)),
		...countUp(counts.latecomers).map((index) => latecomerAccount(index)),
		...countUp(counts.hammerUsers).map((id) => hammerAccount(id)),
	];
}

// k6 starts one arrival at the very end of a constant-arrival-rate run, so a run may start one shopper more than the
// profile names. Each such run gets one spare account for that arrival; an unused spare costs nothing.
const END_OF_RUN_ARRIVALS = 1;

// The accounts the runner signs up for a profile: the profile's counts plus a spare for each end-of-run arrival.
export function signedUpCounts(counts: AccountCounts): AccountCounts {
	return {
		users: counts.users + END_OF_RUN_ARRIVALS,
		latecomers: counts.latecomers + END_OF_RUN_ARRIVALS,
		hammerUsers: counts.hammerUsers,
	};
}

// The file the runner writes the tokens to, and k6 reads: one per profile, so runs never share one.
export function accountsFileName(name: string): string {
	return `${name}-accounts.json`;
}

// The tokens of a file's text, by user name. A text that is not a JSON object holds none, so every shopper then counts
// as missing and the run fails. An entry whose token is not a string is dropped.
export function tokensByUser(text: string): Map<string, string> {
	return attempt(() => JSON.parse(text) as unknown, SyntaxError).match({
		ok: tokenMap,
		err: () => new Map<string, string>(),
	});
}

// The string entries of a parsed JSON object, as a map.
function tokenMap(value: unknown): Map<string, string> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return new Map();
	}
	return new Map(
		Object.entries(value).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

// The token of each account in the order `accountOf` gives them, from 1 to `count`. An account the map does not hold gets
// an empty token, which k6 reads as missing.
export function issuedTokens(
	tokens: ReadonlyMap<string, string>,
	accountOf: (index: number) => Account,
	count: number,
): string[] {
	return countUp(count).map((index) => tokens.get(accountOf(index).user) ?? "");
}
