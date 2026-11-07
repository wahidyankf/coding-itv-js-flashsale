// Hashing of passwords, so the database never holds one. The adapter picks the algorithm and its cost.

// Hashes a password for storage, and checks a password against a stored hash. The stored text carries what the check
// needs (the algorithm, the salt), so a hash made by an older setting still checks.
export type PasswordHasher = {
	hash: (password: string) => Promise<string>;
	verify: (password: string, stored: string) => Promise<boolean>;
};
