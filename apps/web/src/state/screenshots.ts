/**
 * The editor draws the pictures agents ask for: the server has no browser, and the preview here
 * draws with the repository's own stylesheet and components. Every open editor is asked; the
 * one that cannot draw says why, so the server is not left waiting on it.
 */
import type { ScreenshotRequest } from "@ultrapaint/contracts/screenshots";
import { drawSpecimen } from "../canvas/specimens.ts";
import { api } from "./connection.ts";
import { useDesignSystem } from "./design-system.ts";
import { useProject } from "./project.ts";

const draw = async (request: ScreenshotRequest) => {
  const { host } = useProject.getState().info;
  if (host.state !== "running" || !host.url) {
    return { problem: "the editor's preview is not running" };
  }
  const dataUrl = await drawSpecimen(
    host.url,
    request.root,
    useDesignSystem.getState().designSystem,
    {
      height: request.height,
      mode: request.mode,
      space: request.space,
      width: request.width,
      ...(request.nodeId !== undefined && { nodeId: request.nodeId }),
    }
  );
  return dataUrl
    ? { dataUrl }
    : {
        problem:
          "the preview could not draw it: it did not render in time, or the node draws nothing",
      };
};

/** Answers the server's requests for as long as the editor runs. */
export const bindScreenshots = () => {
  api().on("screenshot", (request) => {
    draw(request)
      .catch((error: unknown) => ({
        problem: error instanceof Error ? error.message : String(error),
      }))
      .then((answer) =>
        api().request("screenshots.deliver", {
          requestId: request.requestId,
          ...answer,
        })
      )
      // The request is gone when the server stopped waiting; there is nobody left to tell.
      .catch(() => undefined);
  });
};
