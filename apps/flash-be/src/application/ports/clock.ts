// Time, as the application reads it. Tests fix it; production code reads the clock through this type only.

// Returns the current moment.
export type Clock = () => Date;
