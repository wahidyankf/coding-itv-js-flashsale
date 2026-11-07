# Authentication

A shopper signs up with a user name and a password, and an operator logs in the same way. A login is a **session** that
lives in two cookies. This page gives the reasons for the design. The routes and their errors are in
[HTTP endpoints](../reference/http-endpoints.md#accounts-and-login), and the scenarios are in
[`specs/apps/flash/be/behaviours/auth/`](../../specs/apps/flash/be/behaviours/auth/README.md).

## Why accounts

Before accounts, a user was a name that anyone could type. Anyone could read the place, the hold or the purchase of
another shopper by typing their name, and the operator routes were guarded by one shared token. Accounts fix both: a
request says who it is from by its cookie, so no route takes a user id, and the operator routes need an account with the
role `operator`. Every row also says who made it, who changed it and who deleted it (the audit columns in the
[data model](../../specs/apps/flash/c4/data-model.md)), which needs real users to point at.

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
  B->>A: POST /auth/refresh with refresh_token
  A-->>B: a new pair; the old refresh token is now the previous one
  Note over B,A: someone replays the previous refresh token
  B->>A: POST /auth/refresh with the old refresh_token
  A-->>B: 401, and the session ends
```

- The **access token** is short (15 minutes) because it goes with every request and a copy of it is worth little for long.
  It is checked against a Redis cache first (`session:<hash>`, kept until the token ends) and against Postgres on a miss.
- The **refresh token** is long (7 days) and only goes to `/auth`, so it travels in far fewer requests. Each use replaces
  it. A token that was already replaced is a sign of a copy, so the whole session ends, and the real owner logs in again.
  A week without a visit also ends the login; every use starts a new week.
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
| `Path`         | `/` and `/auth`                        | the refresh token reaches only the auth routes                                         |

`flash-web` is the browser's only server. It passes `/api/auth` and `/api/sales` on with the cookies, moves the refresh
cookie's path to `/api/auth`, and refuses a POST whose `Origin` is another host (`403 cross_site`) as a second lock beside
`SameSite`. The operator routes are not passed on at all.

## Roles

`users.role` is `shopper` or `operator` (a check constraint). Sign-up always makes a shopper. The first operator is made on
the server with `create-operator`, which is also how an operator is made in production: nobody can become one through the
API. A request without a login gets `401 not_authenticated`; a shopper on an operator route gets `403 forbidden`.

## Sessions in the database

A `sessions` row is one login: the two hashes, their ends, the previous refresh hash, and the address and the user agent of
the login. Nothing is erased. A logout or a replayed refresh token marks the row deleted. `users.last_login_at`
says whether an account is still used.

## Known limits

- There is no password reset, e-mail check, two-factor step or account lock. They need an e-mail service or an operator
  procedure that this project does not have.
- A session is not bound to an address. The address and the user agent are recorded to be read, not enforced, because a
  phone changes its address often.
- Redis is a cache for sessions. If it is down, each request reads Postgres, which is slower but correct.
