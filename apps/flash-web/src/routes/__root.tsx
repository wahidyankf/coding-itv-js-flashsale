// Server and browser. The root route: the HTML document, the stylesheet and the head that every page shares.
import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import appCss from "../styles.css?url";

// Set once here, so every page shares the same document and head.
export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "Flash Sale" },
		],
		links: [
			// An empty icon, so the browser does not ask for /favicon.ico.
			{ rel: "icon", href: "data:," },
			{ rel: "stylesheet", href: appCss },
		],
	}),
	component: RootComponent,
});

function RootComponent() {
	return (
		<RootDocument>
			<Outlet />
		</RootDocument>
	);
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body className="min-h-screen bg-stone-50 font-sans text-slate-800 antialiased dark:bg-slate-950 dark:text-slate-200">
				{children}
				<Scripts />
			</body>
		</html>
	);
}
