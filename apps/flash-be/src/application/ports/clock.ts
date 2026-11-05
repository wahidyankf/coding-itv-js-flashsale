// Time is injected so tests can fix it. Production code reads the clock through this type only.
export type Clock = () => Date;
