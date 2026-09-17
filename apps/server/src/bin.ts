import { parseArgs } from "node:util";
import { startServer } from "./server.ts";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: process.env.ULTRAPAINT_PORT ?? "4770" },
    home: { type: "string", default: process.env.ULTRAPAINT_HOME },
    "web-dist": { type: "string", default: process.env.ULTRAPAINT_WEB_DIST },
  },
});

const server = await startServer({
  port: Number(values.port),
  home: values.home,
  webDist: values["web-dist"],
});

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
