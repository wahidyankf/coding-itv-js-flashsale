# Auth

Scenarios for accounts and logins: how a shopper signs up and logs in, how the two cookies (`access_token` and
`refresh_token`) work, and which routes need a login.

## Directory Map

- [accounts.feature](accounts.feature) - `POST /auth/register`, `POST /auth/login` and `GET /auth/me`: names and passwords, and refusing what cannot be used.
- [sessions.feature](sessions.feature) - `POST /auth/refresh` and `POST /auth/logout`: how a login ends, expires and is renewed, and which routes need a login.
