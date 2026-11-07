// What the web scenarios need from a world. The unit world answers from memory with fake timers; the integration
// world goes over real HTTP and real time. The scenario code is the same for both.
export type SaleSpec = {
	stock: number;
	sold: number;
	startsAt: Date;
	endsAt: Date;
};

// What came back from the web server: the status, the body, and the cookies it asked the client to keep.
// `reachedApi` tells whether the request got as far as the API behind it.
export type ApiAnswer = {
	status: number;
	json: Record<string, unknown>;
	cookies: string[];
	reachedApi: boolean;
};

// What a web scenario may do. Both worlds provide it, so the scenario code is the same for each.
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
	// An account that exists, and a shopper who is logged in on this browser (the account is made, the cookies are kept).
	hasAccount: (user: string, password: string) => Promise<void>;
	loggedIn: (user: string) => Promise<void>;
	// The login ends: both tokens (a week passes), or only the access token (15 minutes pass).
	loginEnds: () => void;
	accessTokenEnds: () => void;
	holdsLastItem: (user: string) => void;
	hasBought: (user: string) => void;
	holds: (user: string) => void;
	writeLimit: (count: number) => void;
	paymentDeclines: () => void;
	holdSeconds: (seconds: number) => void;
	// The visitor.
	openPage: () => Promise<void>;
	signUp: (user: string, password: string) => Promise<void>;
	logIn: (user: string, password: string) => Promise<void>;
	logOut: () => Promise<void>;
	pressBuyNow: () => Promise<void>;
	pressCheck: () => Promise<void>;
	pressConfirm: () => Promise<void>;
	// Things that happen to the sale while the page is open.
	setSold: (sold: number) => Promise<void>;
	endSale: () => Promise<void>;
	advance: (seconds: number) => Promise<void>;
	// What the visitor sees. Each waits for the page to catch up, so a slow layer does not fail a correct page.
	expectPageSays: (text: string) => Promise<void>;
	expectButton: (name: string, state: "enabled" | "disabled") => Promise<void>;
	expectNoButton: (name: string) => Promise<void>;
	// The browser keeps neither cookie of a login.
	expectNoLogin: () => Promise<void>;
	// The page as the server renders it, and the address the web server uses for the API.
	renderedPage: () => string;
	apiAddress: () => string;
	// A request to the web server, from this site unless `origin` names another.
	send: (
		method: "GET" | "POST",
		path: string,
		body?: unknown,
		origin?: string,
	) => Promise<ApiAnswer>;
	saleId: string;
};
