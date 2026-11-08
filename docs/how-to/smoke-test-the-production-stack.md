# Smoke test the production stack

Prove that the images build, three API instances start behind nginx, one shopper can buy through the web server, a
crashed Redis or API instance comes back by itself, and the API counts each page shopper by their own address.
You need Docker. The first run builds the images and takes a few minutes.

```bash
npm run smoke:prod
```

The command builds the typekit and flash-commons libraries, then starts [`compose.prod.yaml`](../../compose.prod.yaml) under its own project name (`flash-smoke`) with
random secrets and passwords, free ports and `COOKIE_SECURE=false` (the walk speaks plain HTTP), so it does not touch a stack you started with `npm run docker:prod:up`. It then:

1. checks that three `flash-be` instances are healthy and `/ready` answers;
2. signs a shopper up through the web server, and checks that the admin route refuses a request with no login (`401`) and the
   shopper (`403`);
3. makes an operator with `node dist/create-operator.js` in the stack, logs in, and creates a sale through `POST /api/v1/admin/sales`;
4. checks that the web server does not pass `/api/v1/admin` on, and that the shopper sees the sale through it;
5. joins the queue as the shopper, waits to be admitted, holds an item, and pays (a declined charge is tried again);
6. asks whether the item was bought, and checks that a second reserve is refused with `already_purchased`;
7. makes Redis exit from inside (`redis-cli SHUTDOWN NOSAVE`, as a crash would), waits until Docker has started it again
   and every API instance is ready, and checks that the shopper still sees the sale;
8. does the same with one API instance (`kill 1`);
9. sends a burst of logins through the web server from this machine, with a new `X-Forwarded-For` on each try, until
   one gets `429`, then checks that a login from another address in the network still gets through;
10. removes the stack and its volumes, whether or not a step failed.

It prints one line for each step and ends with `smoke:prod passed`, or stops at the first step that fails and exits
with a non-zero code. It is not part of the pre-push hook because it builds images. Run it before you ship a change to
a Dockerfile, to [`compose.prod.yaml`](../../compose.prod.yaml) or to [`nginx.prod.conf`](../../nginx.prod.conf).
