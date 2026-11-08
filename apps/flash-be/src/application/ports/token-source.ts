// Kind: a plain port (no suffix). Application layer. Makes the random tokens of a login. Randomness sits behind this
// port, so the auth rules take values and return values, and a test can give the same token every time.

// Returns one new token. Each call must return a value nobody else can guess.
export type TokenSource = () => string;
