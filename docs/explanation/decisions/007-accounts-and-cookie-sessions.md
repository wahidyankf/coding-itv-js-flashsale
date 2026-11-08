# 007: Accounts with passwords and cookie sessions

## Status

Accepted. A shopper signs up with a user name and a password, and a login is two `HttpOnly` cookies.

## Context

The task only asks for "a user identifier". A name that anyone can type would let anyone read the place, the hold or
the purchase of another shopper, and the operator routes would need something better than one shared token.

## Decision

- A user has a user name and a password (8 to 128 characters), hashed with scrypt. Sign-up makes a shopper. An operator is made on the server with `create-operator`.
- A session is two cookies: `access_token` (15 minutes, path `/`) and `refresh_token` (7 days, path `/api/v1/auth`, used once).
  The refresh token just before the current one is kept, and if it comes back, the session ends. Only SHA-256 hashes of tokens are stored, in Postgres, with Redis as a cache.
- No route takes a user id. The shopper is the session (`/queue/me`, `/purchases/me`). Cookies are `SameSite=Lax`, and `Secure` when `COOKIE_SECURE` is true.
- The identifier of the task is still there: it is the user name.

## Alternatives considered

- **A plain user name, no password.** It matches the task, but it lets anyone act as anyone, and it gives the audit columns nothing real to point at.
- **One shared token for operators.** It cannot say who changed a sale.
- **Make the first operator from environment variables at startup.** The password would sit in the deploy config, and
  the server would gain a bootstrap step on its start path.
- **A setup script outside the API for the first operator.** It would copy the user name and password rules and the
  hash format, and the copies would drift. `create-operator` is an inbound adapter of the API instead
  ([why the two commands live in the API](../admin-and-sale-windows.md#why-the-two-commands-live-in-the-api)).
- **A signed JWT as the access token.** A replayed refresh token must end the session, which needs server state anyway,
  and a copied JWT cannot be revoked before it ends.
- **One long cookie.** A copy would be worth a week of access on every request.
- **A third-party login (OAuth).** It needs an external account and network in every test.

## Consequences

- It costs more surface: the `/api/v1/auth` routes and their own rate limit (`AUTH_RATE_LIMIT_PER_IP`). It has no password
  reset, e-mail check, two-factor step or account lock. It needs a Postgres read for the session when Redis is down.
- It buys a request that says who it is from, operator routes that need the role `operator`, and a stolen database or Redis copy that cannot be used to act as a user.

## Revisit when

- Real users need a password reset or an e-mail check: add an e-mail service first.
- Sessions must work without a store read on each request: consider signed tokens, and give up instant revoke.

## Related

- [Authentication](../authentication.md) and [admin and sale windows](../admin-and-sale-windows.md).
- Code: [`auth-service.ts`](../../../apps/flash-be/src/application/auth-service.ts), [`session-repository.ts`](../../../apps/flash-be/src/adapters/outbound/postgres/session-repository.ts), [`crypto/`](../../../apps/flash-be/src/adapters/outbound/crypto/).
