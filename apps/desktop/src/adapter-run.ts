/**
 * Starts a bundled ACP adapter on Electron's own binary (ADR 0031): `<electron> run.mjs
 * <adapter.mjs> [args…]`, with `ELECTRON_RUN_AS_NODE=1`, which is what makes the binary Node. The
 * variable goes before the adapter is loaded: the adapter starts the agent, the agent its shell
 * commands, and any of them running a `node` that resolves to Electron, or Electron itself, must
 * get Electron as it is. The adapter then sees the arguments it would have under Node.
 */
import { pathToFileURL } from "node:url";

delete process.env.ELECTRON_RUN_AS_NODE;
const [executable = process.execPath, , adapter, ...rest] = process.argv;
if (!adapter) {
  process.stderr.write("usage: run.mjs <adapter.mjs> [arguments]\n");
  process.exit(2);
}
process.argv = [executable, adapter, ...rest];
await import(pathToFileURL(adapter).href);
