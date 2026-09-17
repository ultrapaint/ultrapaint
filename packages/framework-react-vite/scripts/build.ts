import { buildPreviewBundles } from "../src/build.ts";

await buildPreviewBundles({ force: true });
console.log("framework-react-vite built");
