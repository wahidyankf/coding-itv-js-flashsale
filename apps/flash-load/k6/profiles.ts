// The load profiles and the limits a run must meet. The k6 script and the runner both read this file, so the two never
// disagree. The limits were fixed before the first run and are not changed to make a run pass.

// One load profile: how many shoppers come, how fast, and which faults the run injects.
export type Profile = {
	// Items for sale, and how long a hold lasts in seconds.
	stock: number;
	holdSeconds: number;
	// How many shoppers the queue lets in each second.
	admitPerSecond: number;
	// Distinct shoppers, and how fast they arrive. Shoppers divided by the rate is the length of the run.
	users: number;
	arrivalsPerSecond: number;
	// Shoppers who arrive once every hold has lapsed, at the rate of `LATECOMERS_PER_SECOND` in k6/shop.ts. They take the
	// items that abandoned holds gave back.
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

// Every profile the runner knows. The name is also the command: `npm run load:<name>`.
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
	// Sizing. A visit lasts over a second (the first place poll waits 1 to 2 s), so a shopper who arrives in the herd is
	// still in the system when the herd's last shopper arrives. The machine sets the ceiling, not the system under
	// test. A first try with 2,000 never began: k6 stopped starting virtual users at 1,186 of 2,070 on a Docker VM with
	// 7.7 GiB, about 6 MiB for each user with the schema library bundled in (it has since been removed). `full` starts
	// 670 users and runs. The speed limits below are the same as for every other run and are not loosened for a herd.
	//
	// The pool of a herd profile holds more virtual users than it has shoppers. The herd arrives inside one second, so a
	// pool equal to the herd has no spare user for its last arrival, and k6 drops that arrival ("Insufficient VUs").
	// 800 leaves 100 spare users, and stays under the 1,186 the machine reached.
	//
	// burst: the herd hits the queue. 700 shoppers join within a second for 100 items; admission still lets in 300 a
	// second, so the reserve and confirm steps are spread over about two seconds.
	burst: {
		stock: 100,
		holdSeconds: 10,
		admitPerSecond: 300,
		users: 700,
		arrivalsPerSecond: 700,
		latecomers: 100,
		hammerUsers: 20,
		preAllocatedVUs: 800,
		maxVUs: 800,
		abandonShare: 0.05,
		judgeSpeed: true,
	},
	// contention: the herd hits the sale. Everyone is admitted in the first tick (admission is as large as the crowd), so
	// 700 shoppers reserve in the same moment for 50 items. This is the Lua script and
	// `UPDATE ... WHERE sold < stock` under contention, which the other runs never reach.
	contention: {
		stock: 50,
		holdSeconds: 10,
		admitPerSecond: 700,
		users: 700,
		arrivalsPerSecond: 700,
		latecomers: 100,
		hammerUsers: 20,
		preAllocatedVUs: 800,
		maxVUs: 800,
		abandonShare: 0.05,
		judgeSpeed: true,
	},
} as const satisfies Record<string, Profile>;

// The name of a profile, as the command line and the PROFILE variable of the k6 script spell it.
export type ProfileName = keyof typeof PROFILES;

// The speed and error limits of a run. Fixed before the first run, and the same for every profile that judges speed.
export const LIMITS = {
	// 95 of 100 reserve requests answer faster than this.
	reserveP95Ms: 300,
	// 95 of 100 purchase confirmations answer faster than this. The mock payment takes 150 ms of it.
	purchaseP95Ms: 500,
	// Server errors (5xx) and requests that got no answer.
	serverErrors: 0,
} as const;

// The profile names, in the order PROFILES lists them. The runner checks its argument against them.
export const PROFILE_NAMES = Object.keys(PROFILES) as ProfileName[];
