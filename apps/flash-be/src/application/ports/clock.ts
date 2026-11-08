// Kind: a plain port (no suffix). Application layer. Time as the application reads it, through this type only.

// The one way the application reads the time. A test fixes it, so no rule depends on when the test runs.
export type Clock = () => Date;
