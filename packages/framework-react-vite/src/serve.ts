/**
 * Serves the preview. Run by the server as a child process from the anchor package:
 * `node serve.mjs <options.json> [host]`. The host is loopback unless given; `0.0.0.0` or `::`
 * listen on every interface. It listens on a port the system gives and says which with
 * framework-api's `servingLine`, the server's ready signal. The config is `serve-config.ts`'s;
 * this reads the options, loads the repository's Vite (or ours), listens and stops.
 */
import { readFileSync } from "node:fs";
import { servingLine } from "@ultrapaint/framework-api/serving";
import {
  anchorModules,
  realOptions,
  type ServeOptions,
  serveConfig,
  type Vite,
} from "./serve-config.ts";

const [optionsFile, hostArg] = process.argv.slice(2);
const options = realOptions(
  JSON.parse(readFileSync(optionsFile as string, "utf8")) as ServeOptions
);

const log = (text: string) => console.log(`[ultrapaint] ${text}`);

const modules = anchorModules(options.anchorDir);
if (!modules.resolves("react")) {
  console.error(
    `react cannot be resolved from ${options.anchorDir}. In the settings, set "Resolve imports from" to a package of the repository that depends on react and the design system.`
  );
  process.exit(1);
}

const { module: vite, own: ownVite } = await modules.load<Vite>("vite");
log(ownVite ? "using the bundled Vite" : "using the repository's Vite");

const { config, watch } = await serveConfig({
  host: hostArg || "127.0.0.1",
  log,
  options,
  // Whatever the system gives: the port is said once the server listens on it.
  port: 0,
  vite,
});
const server = await vite.createServer(config);
server.watcher.add([...watch]);
await server.listen();
server.printUrls();
const address = server.httpServer?.address();
if (!(typeof address === "object" && address)) {
  console.error("the preview's server listens on no port");
  process.exit(1);
}
console.log(servingLine(address.port));

const stop = () =>
  server.close().then(
    () => process.exit(0),
    () => process.exit(0)
  );
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
