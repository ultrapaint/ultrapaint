/**
 * A token's value changed from the editor (ADR 0025). The value is the code's: the server writes
 * it where the style system declares it, and the editor hears the design system change. The
 * toast that reports it puts the old value back.
 */
import { toast } from "sonner";
import { promptDialog } from "../components/dialogs.tsx";
import { api } from "../state/connection.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { reportError } from "../state/project.ts";
import { ensureEditable } from "../state/setup.ts";

const setToken = (name: string, value: string | null) =>
  api().request(
    "designSystem.setToken",
    value === null ? { name, remove: true } : { name, value }
  );

/** The default theme's value of a token, as the design system has it from the code. */
const defaultValueOf = (name: string): string | undefined => {
  const ds = useDesignSystem.getState().designSystem;
  if (!ds) {
    return undefined;
  }
  const lists = [
    ...ds.colors.flatMap((g) => g.tokens),
    ...ds.radius,
    ...ds.shadows,
    ...(ds.borderWidths ?? []),
    ...(ds.spacing.tokens ?? []),
    ...ds.typography.sizes,
    ...ds.typography.weights,
    ...ds.typography.fonts,
    ...(ds.typography.leading ?? []),
    ...(ds.typography.tracking ?? []),
    ...(ds.layout?.breakpoints ?? []),
    ...(ds.layout?.containers ?? []),
    ...(ds.motion?.durations ?? []),
    ...(ds.motion?.easings ?? []),
    ...(ds.motion?.animations ?? []),
  ];
  return lists.find((t) => t.name === name)?.value;
};

export const editTokenValue = async (name: string, shown: string) => {
  if (!ensureEditable()) {
    return;
  }
  const current = defaultValueOf(name) ?? shown;
  const next = await promptDialog({
    confirmLabel: "Write to the code",
    defaultValue: current,
    description: `The value is written where your stylesheets declare --${name}, in the default theme.`,
    title: `Edit ${name}`,
  });
  if (next === null || next.trim() === "" || next.trim() === current) {
    return;
  }
  try {
    const { files, previous } = await setToken(name, next.trim());
    toast.success(`${name} is ${next.trim()} in ${files.join(", ")}`, {
      action: {
        label: "Undo",
        onClick: () => {
          setToken(name, previous).catch(reportError);
        },
      },
    });
  } catch (error) {
    reportError(error);
  }
};
