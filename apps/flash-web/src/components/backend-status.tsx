import type { BackendStatus } from "../backend";

export function BackendStatusView({ status }: { status: BackendStatus }) {
	return (
		<p>
			Backend: <strong>{status}</strong>
		</p>
	);
}
