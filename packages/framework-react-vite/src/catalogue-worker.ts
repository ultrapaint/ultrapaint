/**
 * Worker entry for the catalogue build. The TypeScript compiler pass is synchronous and takes
 * seconds on a real design system; on the main thread it would stall every request and starve
 * the RPC keep-alive until the editor's socket is dropped.
 */
import { parentPort, workerData } from "node:worker_threads";
import { buildCatalogue, type ExtractContext } from "./catalogue-extract.ts";

const { ctx, files } = workerData as {
  readonly ctx: ExtractContext;
  readonly files: string[];
};

parentPort?.postMessage(buildCatalogue(ctx, files));
