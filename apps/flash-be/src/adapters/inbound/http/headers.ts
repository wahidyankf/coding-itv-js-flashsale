// The names of the HTTP headers that the API reads or writes (inbound HTTP adapter). The routes share them from here.
// flash-web keeps its own copy (checked by same_as_be_tests.ts), and the e2e and k6 clients write the name themselves, so a
// renamed header fails their tests.

// The header that carries the queue ticket. A ticket is sent in it, and nowhere else.
export const TICKET_HEADER = "x-queue-ticket";

// The header that names one request across flash-web, nginx and the API. The API keeps a caller's id only when it is a
// UUID, makes one otherwise, logs it as `reqId`, and sends it back on every reply, so a shopper can quote it.
export const REQUEST_ID_HEADER = "x-request-id";
