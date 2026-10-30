import { Component } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { appComponentOf, useComponents } from "../state/components.ts";
import { isBoardFrame } from "../state/documents.ts";
import {
  editVariant,
  leaveIsolation,
  useIsolation,
} from "../state/isolation.ts";

/** Whether a key is typed into something: a field, or text being edited on the canvas. */
const typing = (event: KeyboardEvent) => {
  const [target] = event.composedPath();
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
};

/**
 * Says an app component is edited in place (ADR 0041), which member of its choices the edits land
 * on, and the way out: Done, or Escape. On its board (ADR 0045) the board edited says the member,
 * a board a variant, and the banner only names it.
 */
export const IsolationBanner = () => {
  const isolated = useIsolation((s) => s.isolated);
  const file = useComponents((s) =>
    isolated ? appComponentOf(s.components, isolated.component) : undefined
  );

  useEffect(() => {
    if (!isolated) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !typing(event)) {
        event.preventDefault();
        event.stopPropagation();
        leaveIsolation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isolated]);

  if (!(isolated && file?.origin === "app")) {
    return null;
  }
  const choices = file.properties.filter((p) => p.kind === "choice");
  const onBoard = isBoardFrame(isolated.frame);
  const current = isolated.variant
    ? `${isolated.variant.property}\n${isolated.variant.member}`
    : "";
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
      <div
        className="pointer-events-auto flex h-9 items-center gap-2 rounded-lg border border-component/50 bg-sidebar pr-1 pl-2.5 font-body text-sidebar-foreground shadow-black/30 shadow-lg"
        role="status"
      >
        <Component className="size-3.5 text-component" />
        <span className="truncate">
          Editing <span className="font-medium">{file.name}</span>
          <span className="text-muted-foreground">
            {" "}
            · every instance follows
          </span>
        </span>
        {onBoard && isolated.variant ? (
          <span className="font-code text-muted-foreground">
            {isolated.variant.property}={isolated.variant.member}
          </span>
        ) : null}
        {choices.length > 0 && !onBoard ? (
          <NativeSelect
            aria-label="What the edits land on"
            onChange={(e) => {
              const [property, member] = e.target.value.split("\n");
              editVariant(
                property && member !== undefined ? { member, property } : null
              );
            }}
            size="sm"
            title="Edits land on the component's own fields, or on one member of a choice"
            value={current}
          >
            <NativeSelectOption value="">All variants</NativeSelectOption>
            {choices.flatMap((p) =>
              (p.members ?? []).map((m) => (
                <NativeSelectOption
                  key={`${p.name}\n${m}`}
                  value={`${p.name}\n${m}`}
                >
                  {p.name}: {m}
                </NativeSelectOption>
              ))
            )}
          </NativeSelect>
        ) : null}
        <Button onClick={leaveIsolation} size="sm">
          Done
        </Button>
      </div>
    </div>
  );
};
