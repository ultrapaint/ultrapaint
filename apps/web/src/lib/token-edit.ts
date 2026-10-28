/**
 * A token's value changed from the editor (ADR 0028). The value is the design's: the server
 * changes the design system, one undo step, and the code follows on export, or at once with
 * `codeTokens: auto`. The toast that reports it puts the old value back.
 */
import { tokenOf } from "@ultrapaint/contracts/token-table";
import { toast } from "sonner";
import { promptDialog } from "../components/dialogs.tsx";
import { api } from "../state/connection.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { reportError, useProject } from "../state/project.ts";
import { ensureEditable } from "../state/setup.ts";

const setToken = (name: string, value: string | null) =>
  api().request(
    "designSystem.setToken",
    value === null ? { name, remove: true } : { name, value }
  );

/** The default theme's value of a token, as the design system has it from the code. */
const defaultValueOf = (name: string): string | undefined =>
  tokenOf(useDesignSystem.getState().designSystem, name)?.value;

export const editTokenValue = async (name: string, shown: string) => {
  if (!ensureEditable()) {
    return;
  }
  const current = defaultValueOf(name) ?? shown;
  // The design holds the values (ADR 0028): the code follows on export, or at once when set to.
  const auto = useProject.getState().settings?.codeTokens === "auto";
  const next = await promptDialog({
    confirmLabel: "Change",
    defaultValue: current,
    description: auto
      ? "The design system takes it, in the default theme, and it is written to the code at once."
      : "The design system takes it, in the default theme. The code follows when you export it from Sync.",
    title: `Edit ${name}`,
  });
  if (next === null || next.trim() === "" || next.trim() === current) {
    return;
  }
  try {
    const { files, previous } = await setToken(name, next.trim());
    const code = files.filter((f) => !f.endsWith(".json"));
    toast.success(
      code.length > 0
        ? `${name} is ${next.trim()} in the design and in ${code.join(", ")}`
        : `${name} is ${next.trim()} in the design; the code waits for an export`,
      {
        action: {
          label: "Undo",
          onClick: () => {
            setToken(name, previous).catch(reportError);
          },
        },
      }
    );
  } catch (error) {
    reportError(error);
  }
};
