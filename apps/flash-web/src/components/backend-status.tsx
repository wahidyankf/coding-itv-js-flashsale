// Shows whether flash-be answers, on the home page. The colour dot is backed by a word, so colour is never the only signal.
import type { BackendStatus } from "../backend";
import { MUTED_TEXT } from "./ui";

// Shows whether flash-be answers: a colour dot, and the word beside it.
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
