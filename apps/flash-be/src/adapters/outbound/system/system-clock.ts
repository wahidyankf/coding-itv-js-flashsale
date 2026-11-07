// The system clock: the one place the running process reads the time. Outbound adapter for the Clock port. Tests pass a
// fixed clock instead, so a scenario never depends on when it runs.
import type { Clock } from "../../../application/ports/clock.js";

// The real clock. Every production read of the time goes through it, and a test passes a fixed clock in its place.
export const systemClock: Clock = () => new Date();
