// Domain layer: the name of the system user. The migration keeps its own copy, so it never reads live code; a test
// keeps the two equal.

// The user that acts when no person does: the migration, the seed command and the account commands. The row is found
// by name, so no id is written, and a person's name cannot start with `$`.
export const SYSTEM_USERNAME = "$system";
