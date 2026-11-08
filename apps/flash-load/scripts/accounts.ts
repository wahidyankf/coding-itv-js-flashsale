// Signs up every account of a load run before k6 starts, as a real shopper does before a sale opens, so no shopper signs
// up during the sale. Each account is signed up from the address its shopper uses in k6, so the limit on sign-ups per
// address is never reached. The tokens go to a file k6 reads. A failed sign-up fails the run, because the load generator
// then says nothing about the system. Part of the load runner in scripts/.
import { writeFileSync } from "node:fs";
import { HTTP_STATUS, parseSetCookie } from "@flash/flash-commons";
import { attemptAsync, Err, Ok, type Result } from "@flash/typekit";
import {
	ACCESS_COOKIE,
	type Account,
	accountsFileName,
	accountsOf,
	PASSWORD,
	signedUpCounts,
} from "../k6/accounts.ts";
import type { Profile, ProfileName } from "../k6/profiles.ts";
import { NGINX_URL, reportPath } from "./compose.ts";

// Sign-ups in flight at once. Each one hashes its password on the CPU, so a few at a time keep the stack busy without
// holding up the whole phase.
const SIGN_UPS_AT_ONCE = 16;
// How many failures the error names. The rest are left out of the message.
const FAILURES_SHOWN = 3;
const REGISTER_PATH = "/auth/register";

// A signed-up account: its user name and the access token its sign-up set.
type Issued = { user: string; token: string };

// The access token in a reply's Set-Cookie lines, or undefined when the reply sets none, or clears it.
export function accessTokenOf(
	setCookies: readonly string[],
): string | undefined {
	const cookie = setCookies
		.map((line) => parseSetCookie(line))
		.find((parsed) => parsed.name === ACCESS_COOKIE && !parsed.expired);
	return cookie && cookie.value !== "" ? cookie.value : undefined;
}

// The accounts split into groups of at most `size`, so each group signs up together.
export function groupsOf<T>(items: readonly T[], size: number): T[][] {
	return Array.from({ length: Math.ceil(items.length / size) }, (_, group) =>
		items.slice(group * size, (group + 1) * size),
	);
}

// Signs one account up from its own address. Resolves with its token, or with the reason it failed.
async function signUp(account: Account): Promise<Result<Issued, string>> {
	const sent = await attemptAsync(async () => {
		const response = await fetch(`${NGINX_URL}${REGISTER_PATH}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-forwarded-for": account.ip,
			},
			body: JSON.stringify({ username: account.user, password: PASSWORD }),
		});
		// The body is read to the end, so the connection can carry the next sign-up.
		await response.arrayBuffer();
		return response;
	}, TypeError);
	if (sent.isErr()) {
		return new Err(`${account.user}: no answer (${sent.error.message})`);
	}
	const { status, headers } = sent.value;
	if (status !== HTTP_STATUS.created) {
		return new Err(`${account.user}: answered ${status}`);
	}
	const token = accessTokenOf(headers.getSetCookie());
	if (token === undefined) {
		return new Err(`${account.user}: the reply set no access cookie`);
	}
	return new Ok({ user: account.user, token });
}

// Signs up every account of the profile, a group at a time, and writes their tokens to the file k6 reads. Throws when any
// sign-up failed: the load generator failed, so the run says nothing about the system.
export async function signUpAccounts(
	name: ProfileName,
	profile: Profile,
): Promise<void> {
	const accounts = accountsOf(signedUpCounts(profile));
	const replies: Result<Issued, string>[] = [];
	for (const group of groupsOf(accounts, SIGN_UPS_AT_ONCE)) {
		replies.push(
			...(await Promise.all(group.map((account) => signUp(account)))),
		);
	}
	const failures = replies.flatMap((reply) =>
		reply.isErr() ? [reply.error] : [],
	);
	if (failures.length > 0) {
		throw new Error(
			`${failures.length} of ${accounts.length} sign-ups failed, for example: ${failures.slice(0, FAILURES_SHOWN).join("; ")}. ` +
				"The load generator failed, so this run says nothing about the system.",
		);
	}
	const tokens = Object.fromEntries(
		replies.flatMap((reply) =>
			reply.isOk()
				? [[reply.value.user, reply.value.token] as [string, string]]
				: [],
		),
	);
	writeFileSync(reportPath(accountsFileName(name)), JSON.stringify(tokens));
	console.log(`load: ${accounts.length} accounts signed up before the sale`);
}
