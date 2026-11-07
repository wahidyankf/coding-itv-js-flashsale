// The logins that are open, kept in Postgres. Only hashes of tokens come in and out, so a copy of the table cannot be
// used to log in. Redis may cache an answer from here (see redis-session-cache), but Postgres has the last word.
import type { Principal } from "../../domain/auth.js";
import type { UserId } from "../../domain/user.js";

// What the server knows of the client that logs in. Both are only for the record.
export type ClientInfo = {
	ip?: string | undefined;
	userAgent?: string | undefined;
};

// A new login: who it is for, and the hashes and end times of its two tokens.
export type NewSession = ClientInfo & {
	userId: UserId;
	accessHash: string;
	accessExpiresAt: Date;
	refreshHash: string;
	refreshExpiresAt: Date;
};

// The next pair of tokens, to put in place of the pair the refresh token belongs to.
export type Rotation = {
	presentedRefreshHash: string;
	accessHash: string;
	accessExpiresAt: Date;
	refreshHash: string;
	refreshExpiresAt: Date;
	now: Date;
};

export type SessionStore = {
	// Records a login.
	create: (session: NewSession) => Promise<void>;
	// Who the access token belongs to and when it ends, unless it is unknown, expired or ended.
	findByAccess: (
		accessHash: string,
		now: Date,
	) => Promise<{ principal: Principal; expiresAt: Date } | undefined>;
	// Swaps in a new pair when the refresh token is the current one of an open session. The same token used a second time
	// ends the session, because only a copy of it can come back. There is no principal then, and when the token is unknown
	// or expired. `ended` lists the access hashes that stopped working, so a cache can forget them.
	rotate: (rotation: Rotation) => Promise<{
		principal: Principal | undefined;
		ended: string[];
	}>;
	// Ends the sessions that these tokens belong to, and returns the access hashes they had, so a cache can forget them.
	revoke: (hashes: {
		accessHash?: string | undefined;
		refreshHash?: string | undefined;
	}) => Promise<string[]>;
};
