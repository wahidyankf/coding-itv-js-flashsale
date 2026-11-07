// The hook that knows who is logged in. The page renders before the browser's cookie is known, so it starts "checking"
// and asks the server. It also sets the state when a log in, a sign up or a log out finishes, and when the login is
// found gone for good.
import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../error-text";
import type { AuthClient } from "./client";
import { AUTH_TEXT } from "./messages";
import type { Account, AuthMode } from "./types";

// Who is logged in. `checking` lasts from the first paint until the server has answered: the page must not show a login
// form to a shopper who is logged in. `anonymous` may carry a notice, such as "your login has ended".
export type AccountState =
	| { kind: "checking" }
	| { kind: "anonymous"; notice?: string }
	| { kind: "in"; account: Account };

// `onExpired` is the page's way of hearing that a request found the login gone for good.
export function useAccount(
	auth: AuthClient,
	onExpired: (listener: () => void) => () => void,
) {
	const [state, setState] = useState<AccountState>({ kind: "checking" });
	// A reply that comes after the page was left must not set state.
	const alive = useRef(true);

	useEffect(() => {
		alive.current = true;
		void auth.me().then((me) => {
			if (!alive.current) return;
			// "Not logged in" is the normal answer for a visitor, not a problem to show.
			setState(
				me.isOk() ? { kind: "in", account: me.value } : { kind: "anonymous" },
			);
		});
		const stopListening = onExpired(() =>
			setState({ kind: "anonymous", notice: AUTH_TEXT.loginEnded }),
		);
		return () => {
			alive.current = false;
			stopListening();
		};
	}, [auth, onExpired]);

	// Returns the sentence to show when it failed, and nothing when it worked.
	const enter = useCallback(
		async (
			mode: AuthMode,
			username: string,
			password: string,
		): Promise<string | undefined> => {
			const done =
				mode === "login"
					? await auth.login(username, password)
					: await auth.register(username, password);
			if (done.isErr()) {
				return errorText(done.error.errorCode, done.error.retryAfterSeconds);
			}
			setState({ kind: "in", account: done.value });
			return undefined;
		},
		[auth],
	);

	// The cookies are cleared by the server. Even if the call fails, the page stops acting as logged in: the next request
	// would find out, and a shopper who pressed "Log out" expects to be out.
	const leave = useCallback(async () => {
		await auth.logout();
		setState({ kind: "anonymous" });
	}, [auth]);

	return { state, enter, leave };
}
