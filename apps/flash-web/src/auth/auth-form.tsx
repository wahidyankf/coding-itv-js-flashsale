import { type FormEvent, useId, useState } from "react";
import { Spinner } from "../components/spinner";
import { FIELD, OUTLINE, PRIMARY } from "../components/ui";
import { cleanUser, TEXT } from "../sale/messages";
import { AUTH_TEXT, cleanPassword } from "./messages";
import type { AuthMode } from "./types";

const TAB =
	"h-10 flex-1 rounded-md px-3 text-sm font-medium aria-pressed:bg-sky-700 aria-pressed:text-white aria-pressed:hover:bg-sky-700 dark:aria-pressed:bg-sky-500 dark:aria-pressed:text-slate-950 dark:aria-pressed:hover:bg-sky-500";

// The log in and sign up form of a shopper who is not logged in. `enter` sends it and returns the sentence to show when it
// failed. The password stays in this component's state and is never stored anywhere else.
export function AuthCard({
	notice,
	enter,
}: {
	// Why the shopper is here, when it is not their first visit (the login ended).
	notice?: string | undefined;
	enter: (
		mode: AuthMode,
		username: string,
		password: string,
	) => Promise<string | undefined>;
}) {
	const [mode, setMode] = useState<AuthMode>("login");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [problem, setProblem] = useState<string>();
	const [sending, setSending] = useState(false);
	const ids = useId();

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		const name = cleanUser(username);
		if (name === undefined) return setProblem(TEXT.invalidUser);
		// A login is checked by the server alone: an old account may have a password this form would refuse today.
		const secret = mode === "signup" ? cleanPassword(password) : password;
		if (secret === undefined || secret === "") {
			return setProblem(AUTH_TEXT.passwordLength);
		}
		setSending(true);
		setProblem(undefined);
		const failed = await enter(mode, name, secret);
		// On success the page swaps this form for the buying buttons, so there is nothing left to set.
		if (failed !== undefined) {
			setProblem(failed);
			setSending(false);
		}
	};

	const switchTo = (next: AuthMode) => {
		setMode(next);
		setProblem(undefined);
	};

	return (
		<form
			onSubmit={submit}
			aria-busy={sending}
			aria-labelledby={`${ids}-title`}
			className="flex flex-col gap-4"
		>
			<h3 id={`${ids}-title`} className="text-lg font-semibold">
				{mode === "login" ? AUTH_TEXT.loginPrompt : AUTH_TEXT.signupPrompt}
			</h3>
			{notice !== undefined && (
				<p
					role="status"
					className="rounded-lg bg-amber-100 px-3 py-2.5 text-sm leading-6 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200"
				>
					{notice}
				</p>
			)}
			<fieldset className="flex gap-1 rounded-lg border border-slate-300 p-1 dark:border-slate-600">
				<legend className="sr-only">Account</legend>
				<button
					type="button"
					aria-pressed={mode === "login"}
					onClick={() => switchTo("login")}
					className={`${TAB} ${OUTLINE} border-transparent`}
				>
					{AUTH_TEXT.haveAccount}
				</button>
				<button
					type="button"
					aria-pressed={mode === "signup"}
					onClick={() => switchTo("signup")}
					className={`${TAB} ${OUTLINE} border-transparent`}
				>
					{AUTH_TEXT.newHere}
				</button>
			</fieldset>
			<p className="text-sm text-slate-600 dark:text-slate-400">
				{mode === "login" ? AUTH_TEXT.loginHint : AUTH_TEXT.signupHint}
			</p>
			<label
				htmlFor={`${ids}-user`}
				className="flex flex-col gap-1.5 text-sm font-medium"
			>
				{AUTH_TEXT.username}
				<input
					id={`${ids}-user`}
					name="username"
					autoComplete="username"
					autoCapitalize="none"
					spellCheck={false}
					aria-describedby={`${ids}-user-hint`}
					value={username}
					onChange={(event) => setUsername(event.target.value)}
					className={FIELD}
				/>
				<span
					id={`${ids}-user-hint`}
					className="text-xs font-normal text-slate-600 dark:text-slate-400"
				>
					{AUTH_TEXT.usernameHint}
				</span>
			</label>
			<label
				htmlFor={`${ids}-password`}
				className="flex flex-col gap-1.5 text-sm font-medium"
			>
				{AUTH_TEXT.password}
				<input
					id={`${ids}-password`}
					name="password"
					type="password"
					autoComplete={mode === "login" ? "current-password" : "new-password"}
					aria-describedby={
						mode === "signup" ? `${ids}-password-hint` : undefined
					}
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					className={FIELD}
				/>
				{mode === "signup" && (
					<span
						id={`${ids}-password-hint`}
						className="text-xs font-normal text-slate-600 dark:text-slate-400"
					>
						{AUTH_TEXT.passwordHint}
					</span>
				)}
			</label>
			{problem !== undefined && (
				<p
					role="alert"
					className="rounded-lg bg-rose-100 px-3 py-2.5 text-sm leading-6 text-rose-900 dark:bg-rose-400/15 dark:text-rose-200"
				>
					{problem}
				</p>
			)}
			<button type="submit" disabled={sending} className={PRIMARY}>
				{sending && <Spinner />}
				{sending
					? AUTH_TEXT.sending
					: mode === "login"
						? AUTH_TEXT.logIn
						: AUTH_TEXT.signUp}
			</button>
		</form>
	);
}
