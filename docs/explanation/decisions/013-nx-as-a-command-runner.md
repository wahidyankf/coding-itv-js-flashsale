# 013: Nx as a command runner only

## Status

Accepted. Nx runs commands. It has no plugins, and every target is written by hand in a `project.json`.

## Context

The repository has five apps and two libraries in one npm workspace. People and tools need one way to say "typecheck this
app", "test that one", and "check only what my change touches". The pre-push hook needs the last one.

## Decision

- Every target is `"executor": "nx:run-commands"` in the project's `project.json`, and it calls an npm script or a command.
- Every app has `typecheck`, `lint`, `test:quick` and `test:quick:watch`. The same names mean the same things in each app.
- The apps' targets build `libs/typekit` first (`dependsOn`). The e2e apps depend on the app they test (`implicitDependencies`).
- The pre-push hook uses `nx affected` against `origin/main`.
- No `@nx/*` or `nx-*` plugin, and no `nx init`. AGENTS.md states this.

## Alternatives considered

- **Nx plugins (`@nx/vite`, `@nx/js`, and so on).** They infer targets from config files, so the real command is hidden in a
  plugin and moves with its version. Here a reader can open `project.json` and see the command.
- **Only npm workspaces and scripts.** They are enough to run a command, but they have no notion of "affected by this
  change" or of build order between projects. The hook would run everything.
- **Turborepo, Make or a script.** They would give the same, but they add another tool to learn for the same result.

## Consequences

- It costs duplicated target config in each project, no generators, and no inferred targets. A new app copies the targets of another.
- It buys targets that read as plain commands, a pre-push hook that runs only the affected projects, the library built
  before its users, and no plugin upgrades to follow. Nx is a thin layer: the apps' scripts also run without it.

## Revisit when

- The target config is copied many times with small changes: a plugin or a shared preset may then cost less than the copies.
- The number of projects makes `affected` runs slow: look at caching and task outputs, which are not relied on now.

## Related

- [Test layers and coverage](../../reference/test-layers-and-coverage.md#nx-targets) and the rules in [AGENTS.md](../../../AGENTS.md).
- Code: [`nx.json`](../../../nx.json), [`flash-be/project.json`](../../../apps/flash-be/project.json), [`.husky/pre-push`](../../../.husky/pre-push).
