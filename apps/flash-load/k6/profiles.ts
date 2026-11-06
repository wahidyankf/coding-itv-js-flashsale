// The load profiles and the limits a run must meet. The k6 script and the runner both read this file, so the two never
// disagree. The limits were fixed before the first run and are not changed to make a run pass.
export type Profile = {
	// Items for sale, and how long a hold lasts in seconds.
	stock: number;
	holdSeconds: number;
	// How many shoppers the queue lets in each second.
	admitPerSecond: number;
	// Distinct shoppers, and how fast they arrive. Shoppers divided by the rate is the length of the run.
	users: number;
	arrivalsPerSecond: number;
	// Shoppers who arrive once every hold has lapsed, ten a second. They take the items that abandoned holds gave back.
	latecomers: number;
	// Shoppers who flood the queue to prove they are limited and not failed.
	hammerUsers: number;
	// Virtual users k6 starts with, and the most it may add.
	preAllocatedVUs: number;
	maxVUs: number;
	// Share of shoppers who walk away with a hold.
	abandonShare: number;
	// Redis is stopped and started again at these seconds into the run. Absent means Redis stays up.
	redisStopsAtSeconds?: number;
	redisStartsAtSeconds?: number;
	// A profile that breaks a dependency judges only the invariants, not the speed.
	judgeSpeed: boolean;
};

export const PROFILES = {
	smoke: {
		stock: 20,
		holdSeconds: 10,
		admitPerSecond: 100,
		users: 500,
		arrivalsPerSecond: 50,
		latecomers: 50,
		hammerUsers: 10,
		preAllocatedVUs: 150,
		maxVUs: 500,
		abandonShare: 0.05,
		judgeSpeed: true,
	},
	full: {
		stock: 100,
		holdSeconds: 10,
		admitPerSecond: 300,
		users: 5000,
		arrivalsPerSecond: 250,
		latecomers: 100,
		hammerUsers: 20,
		preAllocatedVUs: 600,
		maxVUs: 1500,
		abandonShare: 0.05,
		judgeSpeed: true,
	},
	chaos: {
		stock: 1000,
		holdSeconds: 10,
		admitPerSecond: 200,
		users: 2000,
		arrivalsPerSecond: 100,
		latecomers: 150,
		hammerUsers: 10,
		preAllocatedVUs: 600,
		maxVUs: 1200,
		abandonShare: 0.05,
		redisStopsAtSeconds: 4,
		redisStartsAtSeconds: 9,
		judgeSpeed: false,
	},
	// Everyone arrives inside one second. The runs above spread their shoppers over many seconds, which lets the queue
	// smooth the load. These two do not: the herd arrives first and the system has to take it.
	//
	// Sizing, written before the first run. A visit lasts at least two seconds (a poll for admission, then the reserve),
	// so every shopper who arrives in the same second is in the system at once: the virtual users needed equal the
	// shoppers. `full` already ran with 1,500 virtual users, so 2,000 shoppers asks for a third more and stays inside
	// what this machine is known to run. All of them are started before the clock begins, so k6 does not stall the herd
	// while it starts users. The speed limits below are the same as for every other run and are not loosened for a herd.
	//
	// burst: the herd hits the queue. 2,000 shoppers join within a second for 100 items; admission still lets in 300 a
	// second, so the reserve and confirm steps are spread over about seven seconds.
	burst: {
		stock: 100,
		holdSeconds: 10,
		admitPerSecond: 300,
		users: 2000,
		arrivalsPerSecond: 2000,
		latecomers: 100,
		hammerUsers: 20,
		preAllocatedVUs: 2000,
		maxVUs: 2200,
		abandonShare: 0.05,
		judgeSpeed: true,
	},
	// contention: the herd hits the sale. Everyone is admitted in the first tick (admission is as large as the crowd), so
	// 2,000 shoppers reserve in the same moment for 50 items. This is the Lua script and
	// `UPDATE ... WHERE sold < stock` under contention, which the other runs never reach.
	contention: {
		stock: 50,
		holdSeconds: 10,
		admitPerSecond: 2000,
		users: 2000,
		arrivalsPerSecond: 2000,
		latecomers: 100,
		hammerUsers: 20,
		preAllocatedVUs: 2000,
		maxVUs: 2200,
		abandonShare: 0.05,
		judgeSpeed: true,
	},
} as const satisfies Record<string, Profile>;

export type ProfileName = keyof typeof PROFILES;

// Fixed before the first run.
export const LIMITS = {
	// 95 of 100 reserve requests answer faster than this.
	reserveP95Ms: 300,
	// 95 of 100 purchase confirmations answer faster than this. The mock payment takes 150 ms of it.
	purchaseP95Ms: 500,
	// Server errors (5xx) and requests that got no answer.
	serverErrors: 0,
} as const;

export const PROFILE_NAMES = Object.keys(PROFILES) as ProfileName[];
