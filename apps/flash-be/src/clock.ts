// Time is injected so tests can fix it. Production code reads the system clock through this type only.
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();
