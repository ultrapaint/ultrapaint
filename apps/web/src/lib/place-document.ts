/**
 * DESIGN.md at the root of the repository (ADR 0027): written there when the project has none,
 * or moved there from the designs directory, from Settings and the Sync's step.
 */
import { toast } from "sonner";
import { api } from "../state/connection.ts";
import { reportError } from "../state/project.ts";

export const placeDocument = async () => {
  try {
    const { path } = await api().request(
      "designSystem.placeDocument",
      undefined
    );
    toast.success(`${path} is at the root of the repository.`);
  } catch (error) {
    reportError(error);
  }
};
