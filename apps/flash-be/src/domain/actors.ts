// The user that acts when no person does: the migration, the seed command and the commands that make accounts. The
// migration creates the row and keeps its own copy of the name, so that it never reads live code (a test keeps the two
// equal). The row is found by name, so no id is written anywhere. The name starts with `$`, which the name of a person
// cannot.
export const SYSTEM_USERNAME = "$system";
