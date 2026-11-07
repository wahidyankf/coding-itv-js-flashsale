// Turns a password into text that is safe to store, and checks a password against that text.
export type PasswordHasher = {
	hash: (password: string) => Promise<string>;
	verify: (password: string, stored: string) => Promise<boolean>;
};
