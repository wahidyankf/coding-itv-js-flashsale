// Who is logged in, as flash-be tells it. The tokens are in cookies that the page cannot read.
export type Account = { username: string; role: "shopper" | "operator" };

// The two things the form can do: log in to an account, or make a new one.
export type AuthMode = "login" | "signup";
