# Smoke test the production stack

Prove that the images build, three API instances start behind nginx, and one shopper can buy through the web server.
You need Docker. The first run builds the images and takes a few minutes.

```bash
npm run smoke:prod
```

The command builds the typekit library, then starts `compose.prod.yaml` under its own project name (`flash-smoke`) with
random secrets and free ports, so it does not touch a stack you started with `npm run docker:prod:up`. It then:

1. checks that three `flash-be` instances are healthy and `/ready` answers;
2. refuses an operator with a wrong token, then creates a sale through `POST /admin/sales` with the right one;
3. checks that the web server does not pass `/api/admin` on, and that the shopper sees the sale through it;
4. joins the queue as a shopper, waits to be admitted, holds an item, and pays (a declined charge is tried again);
5. asks whether the item was bought, and checks that a second reserve is refused with `already_purchased`;
6. removes the stack and its volumes, whether or not a step failed.

It prints one line for each step and ends with `smoke:prod passed`, or stops at the first step that fails and exits
with a non-zero code. It is not part of the pre-push hook because it builds images. Run it before you ship a change to
a Dockerfile, to `compose.prod.yaml` or to `nginx.prod.conf`.
