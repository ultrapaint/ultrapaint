/**
 * The editor draws the pictures agents ask for: the server has no browser, and the frames here
 * draw with the editor's system components (ADR 0040). Every open editor is asked; the one that
 * cannot draw says why, so the server is not left waiting on it.
 */
import type { ScreenshotRequest } from "@ultrapaint/contracts/screenshots";
import { drawMeasuredSpecimen, drawSpecimen } from "../canvas/specimens.ts";
import { api } from "./connection.ts";
import { useDesignSystem } from "./design-system.ts";

/**
 * The picture asked for, and with `checks` what the checks measured on it (ADR 0081): the
 * review's picture of a page.
 */
const draw = async (request: ScreenshotRequest) => {
  const { designSystem } = useDesignSystem.getState();
  const options = {
    canvas: request.canvas,
    height: request.height,
    mode: request.mode,
    width: request.width,
    ...(request.nodeId !== undefined && { nodeId: request.nodeId }),
  };
  const { findings, picture: dataUrl } = request.checks
    ? await drawMeasuredSpecimen(request.root, designSystem, options)
    : {
        findings: undefined,
        picture: await drawSpecimen(request.root, designSystem, options),
      };
  return dataUrl
    ? { dataUrl, ...(findings !== undefined && { findings }) }
    : {
        problem:
          "the preview could not draw it: it did not render in time, or the node draws nothing",
      };
};

/**
 * Answers the server's requests until what it returns is called. A request, not data: nothing of
 * it is read again at a connection open, and a snapshot on screen does not stop it.
 */
export const bindScreenshots = () =>
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
