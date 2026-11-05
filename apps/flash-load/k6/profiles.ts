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
