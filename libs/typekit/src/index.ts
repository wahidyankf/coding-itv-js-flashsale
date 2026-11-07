// The public entry of @flash/typekit: the Result type and the wrappers that make a failure a value. Nothing else is public.

// attempt and attemptAsync turn a call that may throw into a Result. They catch only the error classes the caller names;
// any other exception is rethrown, so a bug is never hidden as a failure.
export { attempt, attemptAsync } from "./boundary.js";
// Ok and Err build a fallible function's answer, and Result is its type. A caller reads either side only after a check.
export { Err, Ok, type Result } from "./result.js";
