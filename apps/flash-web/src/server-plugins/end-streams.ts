// Server only. A Nitro runtime plugin, listed in vite.config.ts, that runs once when the built web server starts. It makes
// the server end its proxied event streams when it is asked to stop, so a restart does not wait on them and then cut
// them. It lives here and not in proxy.ts, so a test that imports the proxy adds no stop listener to its own process.
import type { NitroAppPlugin } from "nitro/types";
import { endStreamsOnStop, proxiedStreams } from "../stream-closer";

// The plugin Nitro calls at start. It needs nothing from the Nitro app it is given.
const endStreams = (() => {
	endStreamsOnStop(proxiedStreams);
}) satisfies NitroAppPlugin;

export default endStreams;
