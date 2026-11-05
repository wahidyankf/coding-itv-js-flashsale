// A Server-Sent Events stream as a step reads it: events one by one, with a time limit, and a way to close it.
export type Stream = {
	next: () => Promise<{ event: string; data: Record<string, unknown> }>;
	close: () => void;
};

export async function openStream(
	url: string,
	headers: Record<string, string> = {},
): Promise<Stream> {
	const controller = new AbortController();
	const reply = await fetch(url, { headers, signal: controller.signal });
	if (!reply.ok || !reply.body) {
		throw new Error(`the stream did not open: ${reply.status}`);
	}
	const reader = reply.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const frames: Array<{ event: string; data: Record<string, unknown> }> = [];

	const fill = async (): Promise<void> => {
		const chunk = await reader.read();
		if (chunk.done) throw new Error("the stream ended");
		buffer += decoder.decode(chunk.value, { stream: true });
		for (
			let end = buffer.indexOf("\n\n");
			end >= 0;
			end = buffer.indexOf("\n\n")
		) {
			const frame = buffer.slice(0, end);
			buffer = buffer.slice(end + 2);
			// A line that starts with a colon is a keep-alive comment.
			if (frame.startsWith(":")) continue;
			const event = /^event: (.*)$/m.exec(frame)?.[1] ?? "message";
			const data = JSON.parse(/^data: (.*)$/m.exec(frame)?.[1] ?? "null");
			frames.push({ event, data });
		}
	};

	return {
		async next() {
			const deadline = Date.now() + 8000;
			while (frames.length === 0) {
				if (Date.now() > deadline) throw new Error("no event in time");
				await Promise.race([
					fill(),
					new Promise<void>((resolve) => setTimeout(resolve, 200)),
				]);
			}
			const frame = frames.shift();
			if (!frame) throw new Error("no event");
			return frame;
		},
		close: () => controller.abort(),
	};
}
