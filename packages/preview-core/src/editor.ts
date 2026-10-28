/**
 * The entry of the module the editor's page loads (ADR 0034): the preview core's start-up, drawing
 * with the renderer it is given. The framework's build makes the bundle from this entry and its
 * renderer's `renderToCanvas` (`framework-react-vite/build.ts`), the way Storybook's builder pairs
 * its preview with a renderer: the renderer depends on the interface alone, not on the core.
 */
import type {
  EditorBundle,
  RenderToCanvas,
} from "@ultrapaint/framework-api/browser";
import { createPreview } from "./frame.ts";
import { installHooks, onReloadRequest } from "./styles.ts";

/**
 * The bundle's exports. `startPreview` is the generated entry's only call, and the bundle its only
 * static import, so nothing of the page's runs before it; then, in this order:
 *
 * 1. The page runtime Vite's client calls (`installHooks`): a stylesheet the client loads with
 *    none in place goes to the editor's head, never to a frame.
 * 2. The page's modules (`load`): the stylesheet, the registry, the providers and what they
 *    import, whose stylesheets the client hands to the frames. Their top-level code runs before
 *    the guards, as an application's first code runs in its own page (Vite's client, served
 *    under the base too, keeps its listeners and socket out of the page's).
 * 3. The preview: `createPreview` puts every guard in place (`kernel.ts`), so a module the dev
 *    server replaces from then on runs under them.
 * 4. The dev server's updates and errors, told to every frame.
 */
export const editorBundle = (render: RenderToCanvas): EditorBundle => ({
  startPreview: async (load, hot) => {
    installHooks();
    const { default: setup } = await load();
    const preview = createPreview(render, setup);
    hot?.on("vite:afterUpdate", () => preview.notifyHmr());
    hot?.on("vite:error", ({ err }) =>
      preview.reportError({
        file: err.id,
        line: err.loc?.line,
        message: err.message,
      })
    );
    return { onReloadRequest, preview };
  },
});
