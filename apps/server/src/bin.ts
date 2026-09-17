import { parseArgs } from "node:util";
import { startServer } from "./server.ts";

const { values } = parseArgs({
  options: {
    home: { default: process.env.ULTRAPAINT_HOME, type: "string" },
    port: { default: process.env.ULTRAPAINT_PORT ?? "4770", type: "string" },
    "web-dist": { default: process.env.ULTRAPAINT_WEB_DIST, type: "string" },
  },
});

const server = await startServer({
  home: values.home,
  port: Number(values.port),
  webDist: values["web-dist"],
});

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
