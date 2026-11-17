/**
 * Where an agent makes the takes of a `Variations` task (ADR 0098): working copies the server
 * makes before the turn, in a folder of the designs directory that nothing else reads. The page
 * list, the canvas layout and `familyOf` never see them (the folder is skipped as `.ultrapaint`
 * is), the history keeps no point of them (it skips dot folders), the undo journal records none
 * of their changes, and git ignores them. The agent reaches them with the tools it has, by their
 * file; each is handed in and removed inside the turn.
 */
import { toPosix } from "../hash.ts";

/** The folder of the designs directory the working copies are kept in. */
export const WORKING_COPIES_DIR = ".working-copies";

/** Whether a file, by any path that names its folders, is a working copy or beside them. */
export const isWorkingCopy = (file: string): boolean =>
  toPosix(file).split("/").includes(WORKING_COPIES_DIR);
