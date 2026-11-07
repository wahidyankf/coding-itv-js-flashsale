// The accounts that can log in, kept in Postgres. The system user has no password, so it is not an account.
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

export type AccountStore = {
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
