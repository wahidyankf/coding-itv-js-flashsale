# Degraded

Scenarios for serving shoppers while Redis is down, and for putting Redis back in line when it returns.

## Directory Map

- [serving.feature](serving.feature) - joining, reserving and paying without Redis, at the usual payment speed and still rate limited, a buyer refused a new hold, and the rebuild when it comes back.
