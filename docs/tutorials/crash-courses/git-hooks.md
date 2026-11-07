# Git hooks crash course

A Git hook is a script that Git runs at a fixed moment, such as before a commit or before a push. This repository uses
husky to install its hooks, lint-staged to format the staged files, and commitlint to check each commit message.

## Why this repo uses them

**The problem.** The repository has no CI configuration (there is no `.github/` folder), so nothing on a server runs the
checks. The hooks are the gate: a push cannot leave a machine until the lint, the docs check, the behaviour check, the
quick tests and the 99% coverage floor pass. Several rules in AGENTS.md (no `catch`, no magic numbers, every scenario
bound) are only as strong as the hook that runs them.

**What we did not pick.** No decision record covers the hooks. The split is deliberate: a commit only checks its
message and formats its staged files, so it stays fast, and the slow checks wait for the push.

**What it costs.** A push waits for the whole gate and needs Docker running, because the coverage gate starts the dev
stack. The gate runs only on machines where `npm install` installed the hooks.

## The ideas this repo uses

### husky installs the hooks on `npm install`

The root [`package.json`](../../../package.json) has `"prepare": "husky"`, so `npm install` points Git at
`.husky/_` (`git config core.hooksPath` prints `.husky/_`). Each hook is a short shell file in
[`.husky/`](../../../.husky/). husky runs it with `sh -e`, so the first step that fails stops the hook.

### commit-msg: commitlint and Conventional Commits

[`.husky/commit-msg`](../../../.husky/commit-msg) runs `npx --no -- commitlint --edit "$1"`, and
[`commitlint.config.js`](../../../commitlint.config.js) extends `@commitlint/config-conventional`. A message must look
like `type(scope): subject`, for example `docs: name the new flash-commons modules and the copies that are left`.
`npx --no` never downloads a package, so the hooks use only what `npm install` put in `node_modules`.

### pre-commit: lint-staged formats the staged files

[`.husky/pre-commit`](../../../.husky/pre-commit) runs `npx --no -- lint-staged`. The config is in `package.json`:

```json
"lint-staged": {
	"*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,json,jsonc}": "biome format --write --no-errors-on-unmatched"
}
```

It only formats code and JSON. It does not lint, and it does not touch Markdown.

### pre-push: the full gate, in order

[`.husky/pre-push`](../../../.husky/pre-push) runs seven checks, the cheap ones first and the slow ones last. The list
is in [the pre-push hook](../../reference/test-layers-and-coverage.md#pre-push-hook).

The first five need no Docker. The last two use `nx affected --base=origin/main`, so they run only for the projects
your branch touches ([Nx crash course](nx.md)), and `test:coverage` starts the dev stack.

## Try it here

Check the message of the last commit, as the commit-msg hook would:

```bash
npx --no -- commitlint --from HEAD~1
```

It prints nothing and exits `0` when the message passes. Now give it a message that breaks the rule:

```bash
echo "added stuff" | npx --no -- commitlint
```

```text
⧗   --- input ---
added stuff
✖   subject may not be empty [subject-empty]
✖   type may not be empty [type-empty]

✖   found 2 problems, 0 warnings
```

## Traps to avoid

- **A commit does not check the format of everything.** lint-staged formats only the staged code and JSON, and the
  apps' `lint` targets run only `biome lint`. The format of the Markdown files is checked by `npm run lint`
  (`biome check` on the whole repository), the first step of pre-push. Run it before you push docs.
- **Push fails when Docker is down.** The last step starts the dev stack. Start Docker before you push.
- **Do not skip the gate.** `git push --no-verify`, `git commit --no-verify` and `HUSKY=0` all skip the hooks, and with
  no CI nothing runs the checks later. AGENTS.md allows `--no-verify` only when the user asks. If a step fails, fix the
  cause; the `swe-debugger` agent takes one failure at a time.
- **One coherent change per commit.** commitlint checks the form of a message, not its scope. AGENTS.md asks for one
  change per commit, in neutral words such as "shopper", "sale", "hold" and "purchase".

## Read next

- Official: [husky](https://typicode.github.io/husky/), [lint-staged](https://github.com/lint-staged/lint-staged),
  [commitlint](https://commitlint.js.org/) and [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).
- Ours: [Biome crash course](biome.md), [Nx crash course](nx.md),
  [test layers and coverage](../../reference/test-layers-and-coverage.md) and [`AGENTS.md`](../../../AGENTS.md).
