// The time units that every app converts with. One definition here, so no app writes 1000 or 60_000 itself.
// They convert a length; they are not a contract, so each app may use them freely.

// Milliseconds in one second. The API counts seconds; JavaScript timers count milliseconds.
export const MS_PER_SECOND = 1000;

// Milliseconds in one minute.
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;

// Milliseconds in one hour.
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
