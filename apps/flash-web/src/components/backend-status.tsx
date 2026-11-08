// Part of the home page. Shows whether flash-be answers. The colour dot is backed by a word, so colour is never the only signal.
import type { BackendStatus } from "../backend";
import { MUTED_TEXT } from "./ui";

// The word is the signal for everyone. The dot only adds colour, so it is hidden from screen readers.
export function BackendStatusView({ status }: { status: BackendStatus }) {
	return (
		<p className={`mt-8 text-sm ${MUTED_TEXT}`}>
			<span
				aria-hidden="true"
				className={`mr-2 inline-block size-2 rounded-full align-middle ${status === "ok" ? "bg-emerald-600 dark:bg-emerald-400" : "bg-rose-600 dark:bg-rose-400"}`}
			/>
			Backend: <strong className="font-medium">{status}</strong>
		</p>
	);
}
