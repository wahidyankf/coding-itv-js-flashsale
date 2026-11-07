// The same rule the API uses for a password: 8 to 128 characters. A copy of `usablePassword` in flash-be;
// `same_as_be_tests.ts` fails when the two differ.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export function cleanPassword(raw: string): string | undefined {
	return raw.length >= PASSWORD_MIN_LENGTH && raw.length <= PASSWORD_MAX_LENGTH
		? raw
		: undefined;
}

export const AUTH_TEXT = {
	loginPrompt: "Log in to buy",
	signupPrompt: "Sign up to buy",
	loginHint: "Log in with the name and the password you signed up with.",
	signupHint: "Pick a name and a password. You are logged in right away.",
	username: "Username",
	usernameHint: "1 to 64 letters, digits or . _ @ + - characters.",
	password: "Password",
	passwordHint: `At least ${PASSWORD_MIN_LENGTH} characters.`,
	haveAccount: "I have an account",
	newHere: "I am new",
	logIn: "Log in",
	signUp: "Sign up",
	logOut: "Log out",
	checking: "Checking your login…",
	signedInAs: "Signed in as",
	sending: "Sending…",
	badCredentials: "Wrong name or password.",
	nameTaken: "That name is taken. Choose another one.",
	passwordLength: `Use ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters for the password.`,
	loginEnded: "Your login has ended. Please log in again.",
};
