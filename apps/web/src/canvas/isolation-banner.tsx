import { Component } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { appComponentOf, useComponents } from "../state/components.ts";
import { frameRefOf } from "../state/frame-ref.ts";
import {
  editVariant,
  leaveIsolation,
  useIsolation,
} from "../state/isolation.ts";
import { Banner } from "./banner.tsx";

/**
 * Says an app component is edited in place (ADR 0041), which member of its choices the edits land
 * on, and the way out: Done, or Escape (the `escape` command). On its board (ADR 0045) the board
 * edited says the member, a board a variant, and the banner only names it.
 */
export const IsolationBanner = () => {
  const isolated = useIsolation((s) => s.isolated);
  const file = useComponents((s) =>
    isolated ? appComponentOf(s.components, isolated.component) : undefined
  );

  if (!(isolated && file?.origin === "app")) {
    return null;
  }
  const choices = file.properties.filter((p) => p.kind === "choice");
  const onBoard = frameRefOf(isolated.frame).kind === "board";
  const current = isolated.variant
    ? `${isolated.variant.property}\n${isolated.variant.member}`
    : "";
  return (
    <Banner
      icon={<Component className="text-component" />}
      label={`Editing ${file.name}`}
    >
      <span className="min-w-0 truncate font-body-small text-muted-foreground">
        Editing{" "}
        <span className="font-body-medium text-foreground" title={file.name}>
          {file.name}
        </span>{" "}
        · every instance follows
      </span>
      {onBoard && isolated.variant ? (
        <span className="shrink-0 font-code text-muted-foreground">
          {isolated.variant.property}={isolated.variant.member}
        </span>
      ) : null}
      {choices.length > 0 && !onBoard ? (
        <NativeSelect
          aria-label="Edits land on"
          className="shrink-0 [&>select]:bg-transparent [&>select]:font-body-medium [&>select]:hover:border-transparent [&>select]:hover:bg-accent"
          onChange={(e) => {
            const [property, member] = e.target.value.split("\n");
            editVariant(
              property && member !== undefined ? { member, property } : null
            );
          }}
          size="sm"
          title="Edits land on the component’s own fields, or on one member of a choice"
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
      <Button className="shrink-0" onClick={leaveIsolation} size="sm">
        Done
      </Button>
    </Banner>
  );
};
