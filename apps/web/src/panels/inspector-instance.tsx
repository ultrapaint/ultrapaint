/**
 * The inspector's parts for an app component's instance and its layers (ADR 0114): the instance a
 * layer is in, named under the header in the component colour; a layer's instance overrides, each
 * given back to the main component or made a property; and the instance's way to its main
 * component, with its instance overrides reset or applied to every instance.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import { APP_FROM } from "@ultrapaint/contracts/component-names";
import type { DesignNode, InstanceNode } from "@ultrapaint/contracts/document";
import {
  isInstanceLayer,
  layerOwner,
} from "@ultrapaint/design-document/instance-layers";
import { nodeLabel } from "@ultrapaint/design-document/tree";
import { Component, RotateCcw, Variable } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CutText } from "../components/cut-text.tsx";
import { IconButton } from "../components/icon-button.tsx";
import {
  applyToMain,
  canBeProperty,
  fieldsOf,
  makeProperty,
  type OverriddenField,
  overriddenOn,
  overridesOfInstance,
  resetInstanceOverride,
  resetInstanceOverrides,
} from "../lib/instance-overrides.ts";
import { openBoard } from "../state/board.ts";
import { appComponentOf, useComponents } from "../state/components.ts";
import { rootOfFrame, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { isolate } from "../state/isolation.ts";
import { Row, Section } from "./inspector-fields.tsx";

/**
 * The instance a layer is drawn by, as the frame's document and the components' files hold it
 * now: either changing draws it again.
 */
const useOwner = (frame: string, id: string): InstanceNode | null => {
  const canvas = useEditor((s) => s.canvas);
  const docs = useDocuments((s) => s.docs);
  const components = useComponents((s) => s.components);
  return isInstanceLayer(id)
    ? layerOwner(rootOfFrame(docs, canvas, frame), id, (name) =>
        appComponentOf(components, name)
      )
    : null;
};

/** What the frame's document holds now, read anew as it changes. */
const useSeen = () => ({
  canvas: useEditor((s) => s.canvas),
  docs: useDocuments((s) => s.docs),
});

/** Under the header: the instance a layer is in, so a change is plainly this instance's alone. */
export const InstanceLayerNote = ({
  frame,
  node,
}: {
  frame: string;
  node: DesignNode;
}) => {
  const owner = useOwner(frame, node.id);
  if (!owner) {
    return null;
  }
  return (
    <div
      className="flex h-8 items-center gap-1.5 border-b px-3 font-body-small text-muted-foreground"
      data-instance-layer=""
    >
      <Component className="size-3.5 shrink-0 text-component" />
      <CutText className="min-w-0 truncate">
        In {nodeLabel(owner)} ·{" "}
        <span className="text-foreground">{owner.component}</span>
      </CutText>
    </div>
  );
};

/** How a field's value reads in one line. */
const shown = (value: JsonValue): string => {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
};

/** A field's name as a row says it, with the breakpoint it is set from. */
const fieldLabel = ({ at, field }: OverriddenField) =>
  at === null ? field : `${field} · ${at}`;

/** A layer's instance override on this instance: each field given back, or made a property. */
export const InstanceOverridesSection = ({
  frame,
  node,
}: {
  frame: string;
  node: DesignNode;
}) => {
  const seen = useSeen();
  const found = isInstanceLayer(node.id)
    ? overriddenOn(frame, node.id, seen)
    : null;
  const fields = fieldsOf(found?.over);
  if (!found || fields.length === 0) {
    return null;
  }
  return (
    <Section
      action={
        <IconButton
          className="text-muted-foreground"
          onClick={() => resetInstanceOverride(frame, node.id, fields)}
          size="icon-sm"
          tooltip="Reset this layer to the main component"
        >
          <RotateCcw />
        </IconButton>
      }
      title="Instance overrides"
    >
      {fields.map((f) => (
        <Row key={`${f.at ?? ""}:${f.field}`} label={fieldLabel(f)}>
          <span
            className="min-w-0 flex-1 truncate px-2 font-body"
            data-override={f.field}
          >
            {shown(f.value)}
          </span>
          {canBeProperty(f) ? (
            <IconButton
              className="text-muted-foreground"
              onClick={() => makeProperty(frame, node.id, f)}
              tooltip="Make a property"
            >
              <Variable />
            </IconButton>
          ) : null}
          <IconButton
            className="text-muted-foreground"
            onClick={() => resetInstanceOverride(frame, node.id, [f])}
            tooltip="Reset to the main component"
          >
            <RotateCcw />
          </IconButton>
        </Row>
      ))}
    </Section>
  );
};

/**
 * An app component's instance's way to its main component, which is edited only when asked (ADR
 * 0114), and its instance overrides, the page's own instance's or a nested one's, reset or
 * applied to every instance.
 */
export const MainComponentRows = ({
  frame,
  node,
}: {
  frame: string;
  node: InstanceNode;
}) => {
  const seen = useSeen();
  if (node.from !== APP_FROM) {
    return null;
  }
  const count = overridesOfInstance(frame, node.id, seen)?.held.length ?? 0;
  return (
    <>
      <Row label="Main">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          <Button
            onClick={() => isolate(frame, node)}
            size="sm"
            variant="outline"
          >
            Edit main component
          </Button>
          <Button
            onClick={() => openBoard({ item: node.component, view: "library" })}
            size="sm"
            variant="ghost"
          >
            Go to main
          </Button>
        </div>
      </Row>
      {count > 0 ? (
        <Row label="Overrides">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            <span className="shrink-0 px-2 font-body tabular-nums">
              {count === 1 ? "1 layer" : `${count} layers`}
            </span>
            <Button
              onClick={() => resetInstanceOverrides(frame, node.id)}
              size="sm"
              variant="ghost"
            >
              Reset all
            </Button>
            <Button
              onClick={() => applyToMain(frame, node)}
              size="sm"
              variant="ghost"
            >
              Apply to main
            </Button>
          </div>
        </Row>
      ) : null}
    </>
  );
};
