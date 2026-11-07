# Smoke test the production stack

Prove that the images build, three API instances start behind nginx, and one shopper can buy through the web server.
You need Docker. The first run builds the images and takes a few minutes.

```bash
npm run smoke:prod
```

The command builds the typekit library, then starts `compose.prod.yaml` under its own project name (`flash-smoke`) with
random secrets and passwords, free ports and `COOKIE_SECURE=false` (the walk speaks plain HTTP), so it does not touch a stack you started with `npm run docker:prod:up`. It then:

1. checks that three `flash-be` instances are healthy and `/ready` answers;
2. signs a shopper up through the web server, and checks that the admin route refuses a request with no login (`401`) and the
   shopper (`403`);
3. makes an operator with `node dist/create-operator.js` in the stack, logs in, and creates a sale through `POST /admin/sales`;
4. checks that the web server does not pass `/api/admin` on, and that the shopper sees the sale through it;
5. joins the queue as the shopper, waits to be admitted, holds an item, and pays (a declined charge is tried again);
6. asks whether the item was bought, and checks that a second reserve is refused with `already_purchased`;
7. removes the stack and its volumes, whether or not a step failed.

It prints one line for each step and ends with `smoke:prod passed`, or stops at the first step that fails and exits
with a non-zero code. It is not part of the pre-push hook because it builds images. Run it before you ship a change to
a Dockerfile, to `compose.prod.yaml` or to `nginx.prod.conf`.
