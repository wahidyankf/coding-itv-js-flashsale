# Authentication

A shopper signs up with a user name and a password, and an operator logs in the same way. A login is a **session** that
lives in two cookies. This page gives the reasons for the design. The routes and their errors are in
[HTTP endpoints](../reference/http-endpoints.md#accounts-and-login), and the scenarios are in
[`specs/apps/flash/be/behaviours/auth/`](../../specs/apps/flash/be/behaviours/auth/README.md).

## Why accounts

A request says who it is from by its cookie, so no route takes a user id, and the operator routes need an account with
the role `operator`. Every row also says who made it, changed it and deleted it (the audit columns in the
[data model](../../specs/apps/flash/c4/data-model.md)), which needs real users to point at. Why a password and not a
plain name, and the other options weighed, are in [decision 007](decisions/007-accounts-and-cookie-sessions.md).

## Two tokens

```mermaid
sequenceDiagram
  accTitle: The two tokens of a session
  accDescr: At login the API makes an access token and a refresh token and sets them as cookies. The access token goes with every request for fifteen minutes. When it ends, the browser sends the refresh token to the auth route, which trades it for a new pair. The old refresh token is kept as the previous one. If it is ever used again, the API ends the session.
  participant B as Browser
  participant A as flash-be
  B->>A: login
  A-->>B: access_token (15 min), refresh_token (7 days)
  B->>A: requests with access_token
  Note over B,A: the access token ends
  B->>A: POST /api/v1/auth/refresh with refresh_token
  A-->>B: a new pair; the old refresh token is now the previous one
  Note over B,A: someone replays the previous refresh token
  B->>A: POST /api/v1/auth/refresh with the old refresh_token
  A-->>B: 401, and the session ends
```

- The **access token** is short (15 minutes) because it goes with every request and a copy of it is worth little for long.
  It is checked against a Redis cache first (`session:<hash>`, kept for at most one minute and never past the token's end) and against Postgres on a miss.
- The **refresh token** is long (7 days) and only goes to `/api/v1/auth`, so it travels in far fewer requests. Each use replaces
  it, and the token it replaced is kept as the previous one. If that previous token comes back, it is a sign of a copy,
  so the whole session ends, and the real owner logs in again. An older token is refused.
  A week without a visit also ends the login; every use starts a new week. A refresh token that has run out gets
  `401 invalid_refresh_token` and both cookies are cleared, but the row is not marked deleted, because nothing was
  copied: the login simply ended.
- Both are random (32 bytes). Only the SHA-256 of a token is stored, in Postgres and in the Redis key. A copy of the
  database or of Redis cannot be used to act as a user. A fast hash is right for a token with this much randomness; a
  password needs a slow one.

## Passwords

A password has 8 to 128 characters. The rules stay short on purpose, because a long phrase is better than a pattern. It is
hashed with scrypt (`node:crypto`, a random salt for each password) and compared in constant time. A wrong name and a wrong
password get the same answer, and the check for an unknown name still hashes, so the time does not tell them apart.

## Cookies

| Attribute      | Value                                  | Why                                                                                    |
| -------------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| `HttpOnly`     | always                                 | a script on the page, including an injected one, cannot read the tokens                |
| `SameSite=Lax` | always                                 | another site cannot make the browser send the cookie with a POST                       |
| `Secure`       | `COOKIE_SECURE` (`true` in production) | the browser sends the cookie over HTTPS only; `false` is for plain HTTP on one machine |
| `Path`         | `/` and `/api/v1/auth`                 | the refresh token reaches only the auth routes                                         |

`flash-web` is the browser's only server. It passes `/api/v1/auth` and `/api/v1/sales` on with the cookies, unchanged,
because the browser and the API use the same paths. It refuses a POST whose `Origin` is another host (`403 cross_site`) as a second lock beside
`SameSite`. The operator routes are not passed on at all.

## Roles

`users.role` is `shopper` or `operator` (a check constraint). Sign-up always makes a shopper. The first operator is made on
the server with `create-operator`, which is also how an operator is made in production: nobody can become one through the
API. A request without a login gets `401 not_authenticated`; a shopper on an operator route gets `403 forbidden`.

## Sessions in the database

A `sessions` row is one login: the two hashes, their ends, the previous refresh hash, and the address and the user agent of
the login. Nothing is erased. A logout or a replayed refresh token marks the row deleted; a refresh token that ran out
leaves it as it is. `users.last_login_at`
says whether an account is still used.

## Known limits

- There is no password reset, e-mail check, two-factor step or account lock. They need an e-mail service or an operator
  procedure that this project does not have.
- A session is not bound to an address. The address and the user agent are recorded to be read, not enforced, because a
  phone changes its address often.
- Redis is a cache for sessions. If it is down, each request reads Postgres, which is slower but correct.

## Any instance accepts a login

No session lives in the memory of an API process. The sessions are rows in Postgres, and the cache of live sessions is
the one Redis that every instance shares. A logout or a refresh marks the row and drops the cached copy, so the change
holds on every instance at once. A login made on one instance is accepted by another, a logout on one ends the login on
all of them, and a refresh on one is honoured by another while the old refresh token is refused everywhere. So the API
can run as many instances as the load needs, behind any balancer, with no sticky sessions. The scenarios in
[`auth/sessions.feature`](../../specs/apps/flash/be/behaviours/auth/sessions.feature) run these on two instances.
