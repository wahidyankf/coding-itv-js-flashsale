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
		hammerUsers: 10,
		preAllocatedVUs: 100,
		maxVUs: 400,
		abandonShare: 0.05,
		judgeSpeed: true,
	},
	full: {
		stock: 100,
		holdSeconds: 10,
		admitPerSecond: 300,
		users: 5000,
		arrivalsPerSecond: 250,
		hammerUsers: 20,
		preAllocatedVUs: 300,
		maxVUs: 1500,
		abandonShare: 0.05,
		judgeSpeed: true,
	},
	chaos: {
		stock: 50,
		holdSeconds: 10,
		admitPerSecond: 150,
		users: 2000,
		arrivalsPerSecond: 100,
		hammerUsers: 10,
		preAllocatedVUs: 200,
		maxVUs: 800,
		abandonShare: 0.05,
		redisStopsAtSeconds: 8,
		redisStartsAtSeconds: 14,
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
