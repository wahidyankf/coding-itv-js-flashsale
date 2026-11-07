// Who is logged in, as flash-be tells it. The tokens are in cookies that the page cannot read.
export type Account = { username: string; role: "shopper" | "operator" };

export type AuthMode = "login" | "signup";
