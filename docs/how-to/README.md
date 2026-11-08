# How-To Guides

Short guides for one task each. They assume you have run the project once (see the
[tutorial](../tutorials/run-flash-sale-locally.md)).

## Directory Map

- [run-in-development.md](run-in-development.md) - the daily loop: data stores in Docker, both apps on your machine with reload, tests in watch mode, and how to stop.
- [run-in-production.md](run-in-production.md) - run the whole system in containers: secrets, start, the first operator, HTTPS, update, watch and stop.
- [run-the-demo.md](run-the-demo.md) - show the flash sale in ten minutes: the page, the API requests, Redis down and a load run.
- [add-a-behaviour.md](add-a-behaviour.md) - add a new behaviour as a Gherkin scenario, bind it, and pass `bdd:check`.
- [seed-a-sale.md](seed-a-sale.md) - create a sale with a stock and a window, read it back, and change, list or remove sales as an operator.
- [run-the-load-test.md](run-the-load-test.md) - run the load test and read its result.
- [smoke-test-the-production-stack.md](smoke-test-the-production-stack.md) - build the production stack, walk one shopper through it, and remove it.
- [change-an-endpoint.md](change-an-endpoint.md) - change a route and every place that calls it.
- [handle-failures-with-result.md](handle-failures-with-result.md) - wrap a throwing call with `attempt`, return a `Result`, chain steps and close a switch.
