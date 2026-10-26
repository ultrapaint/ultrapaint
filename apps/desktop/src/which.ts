import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { Effect, Option } from "effect";

/** Whether `file` is a file this user may run. */
export const isExecutable = (file: string) =>
  Effect.tryPromise(async () => {
    const info = await stat(file);
    await access(file, constants.X_OK);
    return info.isFile();
  }).pipe(Effect.orElseSucceed(() => false));

/** Where `name` is on a search path, as a shell would find it: the first that runs. */
export const findExecutable = Effect.fnUntraced(function* (
  name: string,
  searchPath: string
) {
  for (const dir of searchPath.split(path.delimiter)) {
    if (dir.length === 0) {
      continue;
    }
    const candidate = path.join(dir, name);
    if (yield* isExecutable(candidate)) {
      return Option.some(candidate);
    }
  }
  return Option.none<string>();
});
