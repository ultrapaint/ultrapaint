import { buildHostPlugin } from "../src/build.ts";

await buildHostPlugin({ force: true });
console.log("host-plugin built");
