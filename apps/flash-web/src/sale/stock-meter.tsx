// Part of the sale page. The bar under the item count. It shows how much of the stock is still for sale. It is hidden from screen readers, because
// the count next to it says the same thing.
export function StockMeter({
	remaining,
	stock,
}: {
	remaining: number;
	stock: number;
}) {
	// From 0 to 1. A sale with no stock shows an empty bar, not a division by zero.
	const left = stock > 0 ? Math.min(1, remaining / stock) : 0;
	// The width follows the data, and a Tailwind class is fixed when the build runs, so this one value is set inline.
	return (
		<div
			aria-hidden="true"
			className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
		>
			<div
				className="h-full origin-left rounded-full bg-emerald-600 motion-safe:transition-transform dark:bg-emerald-500"
				style={{ transform: `scaleX(${left})` }}
			/>
		</div>
	);
}
