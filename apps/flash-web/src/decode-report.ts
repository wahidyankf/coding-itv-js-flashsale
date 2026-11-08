// Browser and server. Reports a payload from flash-be that did not decode: where it came from, the field, and the type it should have had.
// The shopper sees nothing, so this goes to the developer's console. It never carries the value, which may hold a user name or a token.
// Decision: docs/explanation/decisions/018-decode-payloads-at-the-edge.md (why a payload is checked where it arrives).

// One failed decode. `source` is the URL of a reply, or the URL of a stream and the event name of its frame.
export type DecodeFailure = { source: string; path: string; expected: string };

// Takes one report. A reporter must not throw, because a report must never change what the shopper sees.
export type Reporter = (failure: DecodeFailure) => void;

// The default reporter: one warning line in the browser console, or in the server log.
export const reportDecodeFailure: Reporter = ({ source, path, expected }) => {
	const where = path === "" ? "the top level" : `field "${path}"`;
	console.warn(
		`flash-web: ${source} sent a value that did not decode at ${where}, expected ${expected}.`,
	);
};
