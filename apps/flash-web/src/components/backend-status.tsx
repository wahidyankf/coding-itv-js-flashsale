import type { BackendStatus } from "../backend";

export function BackendStatusView({ status }: { status: BackendStatus }) {
	return (
		<p className="mt-8 text-sm text-slate-600 dark:text-slate-400">
			<span
				aria-hidden="true"
				className={`mr-2 inline-block size-2 rounded-full align-middle ${status === "ok" ? "bg-emerald-600 dark:bg-emerald-400" : "bg-rose-600 dark:bg-rose-400"}`}
			/>
			Backend: <strong className="font-medium">{status}</strong>
		</p>
	);
}
