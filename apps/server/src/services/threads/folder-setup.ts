/**
 * `/setup`'s task (ADR 0062): a folder opened for the first time set up in a chat. Detection has
 * put settings in force already; the agent checks them against the code, saves them with
 * `save_setup`, and tells the user in a few lines what the app is and where its designs go.
 */
import { stylesheetOf } from "@ultrapaint/contracts/setup";
import { Effect, FileSystem, Path } from "effect";
import { OpenProject } from "../../project.ts";
import { DesignSystemService } from "../design-system.ts";
import { RepoPaths } from "../repo-paths.ts";
import { SetupService } from "../setup.ts";
import { TOOLS } from "./agent-ways.ts";
import { userAdds } from "./task-text.ts";

const listed = (items: readonly string[], none: string) =>
  items.length > 0 ? items.join("; ") : none;

export const makeFolderSetup = Effect.gen(function* () {
  const project = yield* OpenProject;
  const setup = yield* SetupService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return (extra: string | undefined) =>
    project.use(
      Effect.gen(function* () {
        const { root, settings } = yield* RepoPaths;
        const { designSystem } = yield* (yield* DesignSystemService).get;
        const found = yield* setup.detect(root);
        const [css] = settings.hostCss;
        const stylesheet =
          css === undefined
            ? undefined
            : stylesheetOf(settings.designsDir, css);
        const designsThere = yield* fs
          .exists(path.join(root, settings.designsDir))
          .pipe(Effect.orElseSucceed(() => false));
        const name = path.basename(root);
        const look = designSystem
          ? ""
          : `
   It has no design system in Ultrapaint yet: say that its designs are drawn in Ultrapaint's
   default look until they make its own, from the code or a new look, in the Design system tab.`;
        return `<ultrapaint-task command="setup">
The user just opened ${name} in Ultrapaint for the first time. Set it up so they can design in it.
Change no file of the code: the setup adds the designs directory and ultrapaint.config.json, and
nothing else.

What Ultrapaint detected:
- The application: ${listed(
          found.anchors.map((a) => `${a.dir} (${a.reason})`),
          "none found"
        )}
- Its stylesheet: ${stylesheet ?? "none found"}${found.stylesNote ? ` (${found.stylesNote})` : ""}
- Components: ${listed(
          found.libraries.map((l) => l.sourceDir),
          "none found"
        )}
- The designs directory: ${settings.designsDir}, ${designsThere ? "already there" : "made when you save"}

1. Check this against the code, reading only what you need: the package that is the application,
   the stylesheet its theme is declared in, where its components are, and its routes or screens.
2. Save with ${TOOLS.save_setup}. Pass designsDir or stylesheet only to change what was detected.
3. Tell the user in a few short lines what the app is (its framework and styling, how many
   components, its screens) and where its designs are kept.${look} Then stop: the user says what
   to design.
${userAdds(extra)}</ultrapaint-task>`;
      })
    );
});
