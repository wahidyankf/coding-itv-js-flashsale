// The names of the HTTP headers that the API reads or writes (inbound HTTP adapter). The routes share them from here.
// flash-web keeps its own copy (checked by same_as_be_tests.ts), and the e2e and k6 clients write the name themselves, so a
// renamed header fails their tests.

// The header that carries the queue ticket. A ticket is sent in it, and nowhere else.
export const TICKET_HEADER = "x-queue-ticket";
