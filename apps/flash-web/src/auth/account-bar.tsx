// Browser only, part of the sale page. The line above the buying card that shows who is logged in, and a log-out button. The page shows it only while a
// shopper is logged in.
import { MUTED_TEXT, SECONDARY_BUTTON, STRONG_TEXT } from "../components/ui";
import { AUTH_TEXT } from "./messages";

// Shows who is logged in, and the button that logs them out.
export function AccountBar({
	username,
	onLogOut,
}: {
	username: string;
	onLogOut: () => void;
}) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-3 md:col-span-2">
			<p className={`text-sm ${MUTED_TEXT}`}>
				{AUTH_TEXT.signedInAs}{" "}
				<strong className={STRONG_TEXT}>{username}</strong>
			</p>
			<button
				type="button"
				onClick={onLogOut}
				className={`${SECONDARY_BUTTON} h-10 text-sm`}
			>
				{AUTH_TEXT.logOut}
			</button>
		</div>
	);
}
