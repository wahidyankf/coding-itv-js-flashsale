// The ports: the small types the application asks the outside world for. Each port is a type in its own file, and an
// adapter implements it. Services use only these, never a Redis or Postgres client.
//
// Suffix rule. The name says what kind of store the port is:
// - Repository: the record of a thing in the source of truth (Postgres). Its rows survive a Redis outage.
// - Store: keyed state that lives in the fast store (Redis) and that a rebuild can lose.
// - Gate: the fast check that answers a question before the source of truth is asked.
// Other ports keep their plain name: Clock, Payment, PasswordHasher, TokenSource, SaleSeeder.

export {};
