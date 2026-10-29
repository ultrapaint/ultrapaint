import {
  type ComponentFile,
  componentFileOf,
} from "@ultrapaint/contracts/components";
import { Effect, FileSystem, Path } from "effect";
import { componentText } from "../services/component-files.ts";

/**
 * A component's file written into a designs directory as an agent writes one, beside the editor:
 * the server reads and checks it when it next lists the components.
 */
export const writeComponentFile = Effect.fnUntraced(function* (
  designsDir: string,
  component: ComponentFile
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(designsDir, componentFileOf(component.name));
  yield* fs.makeDirectory(path.dirname(file), { recursive: true });
  yield* fs.writeFileString(file, componentText(component));
});
