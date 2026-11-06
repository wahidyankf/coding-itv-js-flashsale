# Admin and sale windows

An operator can create a sale in two ways: the seed command, which needs a shell on the server, and `POST /admin/sales`,
which needs a token. This page explains why the API route is small and where its rules stop.

## It only creates

The route creates a sale and nothing else: no change, no delete. A sale that has queues, holds or purchases is data
that other rules depend on. A hold is valid because of the window it was taken in, and the status a shopper reads
follows from the stock and the window. Changing a window under live shoppers would change what those mean. To change
a plan, create a new sale; the old one stays as it was.

## The token

The token comes from `ADMIN_TOKEN`. Without it the route answers `404 not_found`, as if it did not exist, so a
deployment that never set it exposes nothing. The value must be at least 16 characters, or the API refuses to start.

- It is sent as `Authorization: Bearer <token>`.
- Both sides are hashed with SHA-256 before the comparison, which runs in constant time, so the length and content of a
  guess leak nothing.
- It runs in the `onRequest` hook, before the body is read, so a client without the token learns nothing from a broken
  body. The address is counted by the rate limiter first, so guesses are counted too.
- It is never logged: the start-up line only says `admin=on` or `admin=off`.
- The web server does not pass `/api/admin` on. Its proxy has an allow-list of method and path pairs, `POST /admin/sales`
  is not on it, and a test fails if it ever is.

## Windows may not overlap

The brief sells one product at a time, and "the current sale" is the one that opens last. Two overlapping sales would
make "current" a guess. So the API refuses a window that overlaps another sale with `409 sale_overlaps`. A sale may open
at the moment another one closes.

The check and the insert run in one transaction that holds a Postgres advisory lock, so two operators who create the
same window at once get one sale and one `409`. This is checked with a real Postgres in the scenario "Operators who
create the same window at once get one sale".

### Where the rule stops

The rule lives in the admin route only. The seed command and the test fixtures insert rows directly, and many tests rely
on creating several sales that overlap in time. A database constraint would make the rule absolute, but it would also
break those tests, so it was left out. If you need the rule everywhere, add an exclusion constraint on the window and
change the fixtures first.
