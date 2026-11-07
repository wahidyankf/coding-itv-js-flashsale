// The log in and sign up form for a shopper who is not logged in. It keeps what is typed and what is shown, checks the
// input, and asks `enter` to send it. The password stays in this component's state and is stored nowhere else.
import { type FormEvent, useId, useState } from "react";
import { Spinner } from "../components/spinner";
import {
	FIELD,
	MESSAGE_BOX,
	MUTED_TEXT,
	OUTLINE,
	PRIMARY,
	TONE,
} from "../components/ui";
import { checkCredentials } from "./credentials";
import { AUTH_TEXT } from "./messages";
import type { AuthMode } from "./types";

const TAB =
	"h-10 flex-1 rounded-md px-3 text-sm font-medium aria-pressed:bg-sky-700 aria-pressed:text-white aria-pressed:hover:bg-sky-700 dark:aria-pressed:bg-sky-500 dark:aria-pressed:text-slate-950 dark:aria-pressed:hover:bg-sky-500";

// The words that change with the mode: the heading, the hint under the tabs, and the button.
const MODE_TEXT: Record<
	AuthMode,
	{ prompt: string; hint: string; submit: string }
> = {
	login: {
		prompt: AUTH_TEXT.loginPrompt,
		hint: AUTH_TEXT.loginHint,
		submit: AUTH_TEXT.logIn,
	},
	signup: {
		prompt: AUTH_TEXT.signupPrompt,
		hint: AUTH_TEXT.signupHint,
		submit: AUTH_TEXT.signUp,
	},
};

// `enter` returns the sentence to show when it failed, and nothing when it worked. On success the page replaces this
// form with the buying buttons, so the form has nothing left to set.
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
	const words = MODE_TEXT[mode];

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		const checked = checkCredentials(mode, username, password);
		if (checked.isErr()) return setProblem(checked.error);
		setSending(true);
		setProblem(undefined);
		const failed = await enter(
			mode,
			checked.value.username,
			checked.value.password,
		);
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
				{words.prompt}
			</h3>
			{notice !== undefined && (
				<p role="status" className={`${MESSAGE_BOX} ${TONE.amber}`}>
					{notice}
				</p>
			)}
			<fieldset className="flex gap-1 rounded-lg border border-slate-300 p-1 dark:border-slate-600">
				<legend className="sr-only">{AUTH_TEXT.account}</legend>
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
			<p className={`text-sm ${MUTED_TEXT}`}>{words.hint}</p>
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
					className={`text-xs font-normal ${MUTED_TEXT}`}
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
						className={`text-xs font-normal ${MUTED_TEXT}`}
					>
						{AUTH_TEXT.passwordHint}
					</span>
				)}
			</label>
			{problem !== undefined && (
				<p role="alert" className={`${MESSAGE_BOX} ${TONE.rose}`}>
					{problem}
				</p>
			)}
			<button type="submit" disabled={sending} className={PRIMARY}>
				{sending && <Spinner />}
				{sending ? AUTH_TEXT.sending : words.submit}
			</button>
		</form>
	);
}
