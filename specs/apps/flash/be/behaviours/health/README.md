# Health

Scenarios for the two health endpoints, liveness for the process and readiness for its dependencies, and for how the
API stops.

## Directory Map

- [liveness.feature](liveness.feature) - `GET /health` answers without checking anything else.
- [readiness.feature](readiness.feature) - `GET /ready` checks Postgres and Redis.
- [shutdown.feature](shutdown.feature) - what the API does when it is asked to stop.
