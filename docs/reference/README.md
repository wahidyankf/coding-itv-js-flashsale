# Reference

Facts to look up. The pages list what exists; they do not explain why.

## Directory Map

- [code-map.md](code-map.md) - where each kind of thing lives, with a link to each app's README. Start here when you
  change the code.
- [http-endpoints.md](http-endpoints.md) - the HTTP routes of `flash-be` and `flash-web`, with their responses.
- [test-layers-and-coverage.md](test-layers-and-coverage.md) - test layers, Nx targets, the coverage floor, and the
  pre-push hook.
- [load-test.md](load-test.md) - the load test stack, the numbers of each profile, and where a run writes its results.
- [retry-policies.md](retry-policies.md) - the backoff, cap and max attempts of every retry, and why the Redis reconnect
  has no max. The APIs of the libraries are in their READMEs: [typekit](../../libs/typekit/README.md) and
  [flash-commons](../../libs/flash-commons/README.md).
