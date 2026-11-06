import {
	parseFrames,
	readStreamEvent,
	type StreamEvent,
} from "@flash/contract";

// A Server-Sent Events stream as a step reads it: events one by one, with a time limit, and a way to close it.
export type Stream = {
	next: () => Promise<StreamEvent>;
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
	const events: StreamEvent[] = [];

	const fill = async (): Promise<void> => {
		const chunk = await reader.read();
		if (chunk.done) throw new Error("the stream ended");
		buffer += decoder.decode(chunk.value, { stream: true });
		const parsed = parseFrames(buffer);
		buffer = parsed.rest;
		for (const frame of parsed.frames) {
			const event = readStreamEvent(frame);
			if (event) events.push(event);
		}
	};

	return {
		async next() {
			const deadline = Date.now() + 8000;
			while (events.length === 0) {
				if (Date.now() > deadline) throw new Error("no event in time");
				await Promise.race([
					fill(),
					new Promise<void>((resolve) => setTimeout(resolve, 200)),
				]);
			}
			const event = events.shift();
			if (!event) throw new Error("no event");
			return event;
		},
		close: () => controller.abort(),
	};
}
