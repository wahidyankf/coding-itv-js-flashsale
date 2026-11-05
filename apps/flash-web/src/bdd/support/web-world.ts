// What the web scenarios need from a world. The unit world answers from memory with fake timers; the integration
// world goes over real HTTP and real time. The scenario code is the same for both.
export type SaleSpec = {
	stock: number;
	sold: number;
	startsAt: Date;
	endsAt: Date;
};

export type ApiAnswer = { status: number; json: Record<string, unknown> };

export type WebWorld = {
	// Each scenario starts clean and ends by clearing the page.
	reset: () => void;
	clear: () => void;
	now: () => Date;
	// The state of the sale, before the page is opened.
	addSale: (spec: SaleSpec) => Promise<void>;
	cutOff: () => void;
	slowAdmission: () => void;
	queueAhead: (count: number) => void;
	holdsLastItem: (user: string) => void;
	hasBought: (user: string) => void;
	holds: (user: string) => void;
	writeLimit: (count: number) => void;
	paymentDeclines: () => void;
	holdSeconds: (seconds: number) => void;
	// The visitor.
	openPage: () => Promise<void>;
	pressBuyNow: (name: string) => Promise<void>;
	pressCheck: (name: string) => Promise<void>;
	pressConfirm: () => Promise<void>;
	// Things that happen to the sale while the page is open.
	setSold: (sold: number) => Promise<void>;
	endSale: () => Promise<void>;
	advance: (seconds: number) => Promise<void>;
	// What the visitor sees. Each waits for the page to catch up, so a slow layer does not fail a correct page.
	expectPageSays: (text: string) => Promise<void>;
	expectButton: (name: string, state: "enabled" | "disabled") => Promise<void>;
	// The page as the server renders it, and the address the web server uses for the API.
	renderedPage: () => string;
	apiAddress: () => string;
	// A request to the web server.
	send: (
		method: "GET" | "POST",
		path: string,
		body?: unknown,
	) => Promise<ApiAnswer>;
	saleId: string;
};
