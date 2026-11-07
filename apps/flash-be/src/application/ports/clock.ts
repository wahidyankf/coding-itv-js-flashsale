// Kind: a plain port (no suffix). Time, as the application reads it. Tests fix it; production code reads the clock
// through this type only.

// The one way the application reads the time. A test fixes it, so no rule depends on when the test runs.
export type Clock = () => Date;
