import type { Result } from "@flash/typekit";
import type { Principal, Role } from "../../domain/auth.js";

export type NewAccount = {
	username: string;
	passwordHash: string;
	role: Role;
	// The user who made the account. Left out, the account is its own author, as a shopper who signs up.
	createdBy?: string | undefined;
};

// The accounts that can log in. A user without a password (the system) is not an account.
export type AccountStore = {
	register: (
		account: NewAccount,
	) => Promise<Result<Principal, "username_taken">>;
	findCredentials: (
		username: string,
	) => Promise<{ principal: Principal; passwordHash: string } | undefined>;
};
