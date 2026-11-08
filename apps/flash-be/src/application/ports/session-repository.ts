// Kind: repository (a record kept in Postgres, which survives a Redis outage). The logins that are open. Redis may cache
// an answer from here (see redis-session-cache), but Postgres has the last word. Application layer, port.
import type { Principal } from "../../domain/auth.js";
import type { UserId } from "../../domain/user.js";

// What the server knows of the client that logs in. Both are only for the record.
export type ClientInfo = {
	ip?: string | undefined;
	userAgent?: string | undefined;
};

// A new login. It holds the hashes of its two tokens, never the tokens.
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

// The logins that are open, stored by the hash of their tokens. A copy of the table cannot log anyone in, and Postgres
// decides whether a login still counts.
export type SessionRepository = {
	// Records a login.
	create: (session: NewSession) => Promise<void>;
	// Who the access token belongs to and when it ends, unless it is unknown, expired or ended.
	findByAccess: (
		accessHash: string,
		now: Date,
	) => Promise<{ principal: Principal; expiresAt: Date } | undefined>;
	// Swaps in a new pair for the current refresh token of an open session. A token used a second time ends the session,
	// because only a copy of it can come back. No principal means the token is unknown, expired or reused. `ended` lists
	// the access hashes that stopped working, so a cache can forget them.
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
