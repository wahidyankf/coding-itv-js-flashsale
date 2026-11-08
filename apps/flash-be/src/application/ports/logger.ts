// Kind: a plain port (no suffix). Application layer. Where the events an operator acts on are written: a store that drops
// and comes back, a rebuild, a refund. composition.ts and main.ts pass the server's log; a test passes a recording one.

// The fields of one line, such as the sale it is about. A field never holds a password, a token or a cookie.
export type LogFields = Record<string, unknown>;

// One method per level, each writing one line with its fields and a short message.
export type Logger = {
	debug: (fields: LogFields, message: string) => void;
	info: (fields: LogFields, message: string) => void;
	warn: (fields: LogFields, message: string) => void;
	error: (fields: LogFields, message: string) => void;
};

// A logger that writes nothing, for a part that is built without the server's log, such as a command or a test.
export const silentLogger: Logger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};
