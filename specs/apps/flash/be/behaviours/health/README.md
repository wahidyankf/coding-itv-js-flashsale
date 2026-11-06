# Health

Scenarios for the two health endpoints: liveness for the process and readiness for its dependencies.

## Directory Map

- [liveness.feature](liveness.feature) - `GET /health` answers without checking anything else.
- [readiness.feature](readiness.feature) - `GET /ready` checks Postgres and Redis.
