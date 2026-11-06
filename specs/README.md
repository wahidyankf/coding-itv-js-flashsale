# Specifications

This directory is the canonical statement of how the flash sale system must behave and how it is built. Where the
documentation under [`docs/`](../docs/README.md) and these specifications disagree, these win, and the disagreement is a
bug to fix.

## Directory Map

- [apps/](apps/README.md) - the specifications of the apps: their behaviour scenarios and the flash sale C4 model.

Only the apps use Gherkin. The libraries and the repository's tools are tested with plain Vitest tests next to their code.
