// The sale paths of the k6 script. The API's paths come from the table in @flash/flash-commons, and this module only fills
// the sale id into them, so the script keeps no path of its own. Pure: scripts/bundle.ts bundles it into the k6 script,
// so it uses no Node built-in.

// Fills the `:saleId` placeholder of an API path with the sale this run uses. A path without the placeholder is returned as it is.
export function saleRoute(template: string, saleId: string): string {
	return template.replace(":saleId", saleId);
}
