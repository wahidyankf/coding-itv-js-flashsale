# Specifications

This directory is the canonical statement of how the flash sale system must behave and how it is built. Where the
documentation under [`docs/`](../docs/README.md) and these specifications disagree, these win, and the disagreement is a
bug to fix.

## Directory Map

- [flash/](flash/README.md) - the flash sale product: its architecture, the API (`be`), and the web app (`web`).
- [typekit/](typekit/README.md) - the typed `Result` and `attempt` library in `libs/typekit`.
- [tooling/](tooling/README.md) - the repository's own tools, such as the behaviour check.
