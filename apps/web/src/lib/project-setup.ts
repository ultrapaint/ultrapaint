/**
 * A folder to design on is chosen in the settings' Repository section. Setting one up, an agent
 * checking what detection found against the code and saving it (`/setup`), is never started on
 * its own: a new chat suggests it while the settings are detected and not saved (ADR 0073).
 */
import { useProject } from "../state/project.ts";

/** The settings' Repository section, where the folder is chosen. */
export const chooseFolder = () =>
  useProject.getState().openSettings(true, "repository");
