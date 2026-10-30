/**
 * A token's value changed from the editor (ADR 0028). The value is the design's: the server
 * changes the design system (`designSystem.edit`, ADR 0045), one undo step, and the code follows
 * on export, or at once with `codeTokens: auto`. The toast that reports it undoes that step.
 */
import type { DesignSystemEdit } from "@ultrapaint/contracts/design-system-edit";
import { tokenOf } from "@ultrapaint/contracts/token-table";
import { toast } from "sonner";
import { promptDialog } from "../components/dialogs.tsx";
import { api } from "../state/connection.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { reportError, useProject } from "../state/project.ts";
import { ensureEditable } from "../state/setup.ts";

/**
 * The design system changed by `ops` as one undo step, with the files written; one of them
 * that does not fit refuses them all.
 */
export const editDesignSystem = (
  ops: readonly DesignSystemEdit[],
  label?: string
) =>
  api().request("designSystem.edit", {
    ops,
    ...(label !== undefined && { label }),
  });

/** The default theme's value of a token, as the design system has it from the code. */
const defaultValueOf = (name: string): string | undefined =>
  tokenOf(useDesignSystem.getState().designSystem, name)?.value;

/** A token's default value set, the token added where its kind goes when the design lacks it. */
const setToken = (name: string, value: string) =>
  editDesignSystem([
    defaultValueOf(name) === undefined
      ? { name, op: "addToken", value }
      : { name, op: "setValue", value },
  ]);

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
    const { files } = await setToken(name, next.trim());
    const code = files.filter((f) => !f.endsWith(".json"));
    toast.success(
      code.length > 0
        ? `${name} is ${next.trim()} in the design and in ${code.join(", ")}`
        : `${name} is ${next.trim()} in the design; the code waits for an export`,
      {
        action: {
          label: "Undo",
          onClick: () => {
            api().request("edit.undo", undefined).catch(reportError);
          },
        },
      }
    );
  } catch (error) {
    reportError(error);
  }
};
