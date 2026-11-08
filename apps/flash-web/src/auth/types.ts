// Who is logged in, as flash-be tells it, and the decoder that checks it. The tokens are in cookies that the page cannot read.
// It sits in the account feature; the account client and the page's web API (web-api.ts) both decode with it.
import {
	type Decoder,
	nonEmptyText,
	object,
	oneOf,
} from "@flash/flash-commons";

const ROLES = ["shopper", "operator"] as const;

// The signed-in account as flash-be sends it: a user name and a role. The page never sees the tokens.
export type Account = { username: string; role: (typeof ROLES)[number] };
// Checks an account reply before the page uses it. An unknown role is refused, so the page never acts on one.
export const decodeAccount: Decoder<Account> = object({
	username: nonEmptyText,
	role: oneOf(ROLES),
});

// The two things the form can do: log in to an account, or make a new one.
export type AuthMode = "login" | "signup";
