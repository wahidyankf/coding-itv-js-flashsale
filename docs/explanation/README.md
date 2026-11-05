# Explanation

Pages that explain why the system is built the way it is. They give the reasons and the trade-offs. For the exact
behaviour, read the specs.

## Directory Map

- [liveness-and-readiness.md](liveness-and-readiness.md) - why `/health` checks nothing and `/ready` checks the stores.
- [waiting-queue.md](waiting-queue.md) - why shoppers queue before they reserve, and how the queue admits them.
