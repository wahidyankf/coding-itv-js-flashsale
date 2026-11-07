// The system clock: the one place the running process reads the time. Outbound adapter for the Clock port. Tests pass a
// fixed clock instead, so a scenario never depends on when it runs.
import type { Clock } from "../../../application/ports/clock.js";

// The clock of the running process. Each call reads the time now.
export const systemClock: Clock = () => new Date();
