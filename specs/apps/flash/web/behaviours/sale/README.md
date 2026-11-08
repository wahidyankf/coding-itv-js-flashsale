# Sale

Scenarios for the sale page: what it shows, how a logged-in shopper buys, and how a shopper checks the outcome. The login itself is in [account/](../account/README.md).

## Directory Map

- [status.feature](status.feature) - the status and items left, how the page follows changes (the sale opening, selling out and ending), and what it says when no sale is open, the sale cannot be loaded or live updates stop.
- [buying.feature](buying.feature) - Buy Now through the queue to a held item and a confirmed purchase with its Purchase ID, and the message for the main outcomes, a lost place in the line among them, a turn that ends before the hold, and a sale that cannot be reached or fails.
- [checking.feature](checking.feature) - Check my status finds a purchase (with its Purchase ID), a hold or nothing, and what the page says when the sale cannot be reached or the login has ended.
