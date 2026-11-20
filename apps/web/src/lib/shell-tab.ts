/**
 * Tells the desktop app the open project's name and icon as its server shows them (ADR 0107), so
 * that its tab, and the projects' list, show them too: once they are read, and again at each
 * change (Settings › Name and icon). Nothing in a browser, which has no tabs.
 */
import { platform } from "../platform.ts";
import { useProject } from "../state/project.ts";

/** Follows the project's name and icon for the rest of the editor's life. */
export const followShellTab = () => {
  const describe = platform().projects?.describe;
  if (!describe) {
    return () => undefined;
  }
  let told: string | null = null;
  const tell = () => {
    const { info, loaded } = useProject.getState();
    if (!(loaded && info.name)) {
      return;
    }
    const look = { ...(info.icon ? { icon: info.icon } : {}), name: info.name };
    const text = JSON.stringify(look);
    if (text === told) {
      return;
    }
    told = text;
    // A tab that keeps its old name is all that is lost.
    describe(look).catch(() => undefined);
  };
  tell();
  return useProject.subscribe(tell);
};
