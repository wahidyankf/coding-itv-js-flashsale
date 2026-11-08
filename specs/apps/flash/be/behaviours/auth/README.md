# Auth

Scenarios for accounts and logins: how a shopper signs up and logs in, how the two cookies (`access_token` and
`refresh_token`) work, and which routes need a login.

## Directory Map

- [accounts.feature](accounts.feature) - `POST /api/v1/auth/register` and `POST /api/v1/auth/login`: names and passwords, refusing what cannot be used, and storing only hashes.
- [sessions.feature](sessions.feature) - `GET /api/v1/auth/me`, `POST /api/v1/auth/refresh` and `POST /api/v1/auth/logout`: who is logged in, how a login ends, expires and is renewed, and which routes need a login.
