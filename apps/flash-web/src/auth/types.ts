// Who is logged in, as flash-be tells it, and the decoder that checks it. The tokens are in cookies that the page cannot read.
import {
	type Decoder,
	nonEmptyText,
	object,
	oneOf,
} from "@flash/flash-commons";

const ROLES = ["shopper", "operator"] as const;

export type Account = { username: string; role: (typeof ROLES)[number] };
export const decodeAccount: Decoder<Account> = object({
	username: nonEmptyText,
	role: oneOf(ROLES),
});

// The two things the form can do: log in to an account, or make a new one.
export type AuthMode = "login" | "signup";
