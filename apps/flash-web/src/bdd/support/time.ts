// Time phrases of the scenarios ("in 2 hours", "1 hour ago"), read against a given moment so each layer can pick its own
// clock. The reader lives in @flash/flash-commons; this module re-exports it. Test support only.
export { relativeTime } from "@flash/flash-commons";
