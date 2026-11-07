// Kind: repository (a record kept in Postgres, which survives a Redis outage). The accounts that can log in. The system
// user has no password, so it is not an account. Application layer, port.
import type { Result } from "@flash/typekit";
import type { Principal, Role } from "../../domain/auth.js";
import type { UserId, Username } from "../../domain/user.js";

// A new account: its name, the hash of its password, its role, and the user who made it.
export type NewAccount = {
	username: Username;
	passwordHash: string;
	role: Role;
	// The user who made the account. Left out, the account is its own author, as a shopper who signs up.
	createdBy?: UserId | undefined;
};

// The accounts that can log in. The unique index on a live name is what stops two sign-ups from both winning, so the
// store, not the service, has the last word on a name.
export type AccountRepository = {
	// Adds the account, unless a live account already has its name. The unique index decides, so two sign-ups for one
	// name cannot both succeed.
	register: (
		account: NewAccount,
	) => Promise<Result<Principal, "username_taken">>;
	// The principal and the password hash of the account with this name, or nothing when there is none.
	findCredentials: (
		username: Username,
	) => Promise<{ principal: Principal; passwordHash: string } | undefined>;
};
