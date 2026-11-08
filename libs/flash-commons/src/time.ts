// The time units every app converts with, so no app writes 1000 or 60_000 itself. They are plain lengths, not a contract.
// Part of the pure main entry.

// Milliseconds in one second. The API counts seconds; JavaScript timers count milliseconds.
export const MS_PER_SECOND = 1000;

// Milliseconds in one minute. Built from the second, so the units cannot drift apart.
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;

// Milliseconds in one hour. Built from the minute, so the units cannot drift apart.
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
