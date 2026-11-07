// The account's words and rules: the sentences of the log in and sign up form, the sentences for the account's errors,
// and the two checks the form makes on a user name and a password. The two checks copy flash-be, and
// `same_as_be_tests.ts` fails when a copy drifts from it.

// The password rule of flash-be: 8 to 128 characters.
export const PASSWORD_MIN_LENGTH = 8;
// The longest password flash-be accepts.
export const PASSWORD_MAX_LENGTH = 128;

const USERNAME_RULE = "1 to 64 letters, digits or . _ @ + - characters.";
// Trimmed and lowercased first, so a bad name is refused before anything is sent.
const USER_ID = /^[a-z0-9][a-z0-9._@+-]{0,63}$/;

// The user name in the form flash-be keeps it, or undefined when flash-be would refuse it.
export function cleanUser(raw: string): string | undefined {
	const user = raw.trim().toLowerCase();
	return USER_ID.test(user) ? user : undefined;
}

// The password as typed when it has a usable length, or undefined when it does not.
export function cleanPassword(raw: string): string | undefined {
	return raw.length >= PASSWORD_MIN_LENGTH && raw.length <= PASSWORD_MAX_LENGTH
		? raw
		: undefined;
}

// Every sentence of the account forms. Kept in one table so the wording can be read and changed in one place.
export const AUTH_TEXT = {
	loginPrompt: "Log in to buy",
	signupPrompt: "Sign up to buy",
	loginHint: "Log in with the name and the password you signed up with.",
	signupHint: "Pick a name and a password. You are logged in right away.",
	username: "Username",
	usernameHint: USERNAME_RULE,
	invalidUser: `Use ${USERNAME_RULE}`,
	password: "Password",
	passwordHint: `At least ${PASSWORD_MIN_LENGTH} characters.`,
	account: "Account",
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

// The sentence for each error code about the account. Undefined for any other code, which another file answers.
export function authErrorText(errorCode: string): string | undefined {
	switch (errorCode) {
		case "invalid_user":
			return AUTH_TEXT.invalidUser;
		case "invalid_password":
			return AUTH_TEXT.passwordLength;
		case "invalid_credentials":
			return AUTH_TEXT.badCredentials;
		case "username_taken":
			return AUTH_TEXT.nameTaken;
		case "not_authenticated":
		case "invalid_refresh_token":
			return AUTH_TEXT.loginEnded;
		default:
			return undefined;
	}
}
