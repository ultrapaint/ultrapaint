/**
 * The inspector's parts for an app component's instance and its layers (ADR 0114): the instance a
 * layer is in, named under the header in the component colour; a layer's overrides, each given
 * back to the main component or made a property; and the instance's way to its main component,
 * with its overrides reset or applied to every instance.
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
  resetOverride,
  resetOverrides,
} from "../lib/instance-overrides.ts";
import { openBoard } from "../state/board.ts";
import {
  appFileOf,
  nodeIn,
  rootOfFrame,
  useDocuments,
} from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { isolate } from "../state/isolation.ts";
import { Row, Section } from "./inspector-fields.tsx";

/** The instance a layer is drawn by, as the frame's document holds it now. */
const useOwner = (frame: string, id: string): InstanceNode | null => {
  const canvas = useEditor((s) => s.canvas);
  return useDocuments((s) =>
    isInstanceLayer(id)
      ? layerOwner(rootOfFrame(s.docs, canvas, frame), id, appFileOf)
      : null
  );
};

/** The override of a layer, as its instance in the frame's document holds it now. */
const useOverride = (frame: string, id: string) => {
  // Read again whenever the documents change.
  useDocuments((s) => s.docs);
  return isInstanceLayer(id) ? overriddenOn(frame, id) : null;
};

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

/** A layer's overrides on this instance: each given back, or made a property. */
export const OverridesSection = ({
  frame,
  node,
}: {
  frame: string;
  node: DesignNode;
}) => {
  const found = useOverride(frame, node.id);
  const fields = fieldsOf(found?.over);
  if (!found || fields.length === 0) {
    return null;
  }
  return (
    <Section
      action={
        <IconButton
          className="text-muted-foreground"
          onClick={() => resetOverride(frame, node.id, fields)}
          size="icon-sm"
          tooltip="Reset all of this layer's overrides"
        >
          <RotateCcw />
        </IconButton>
      }
      title="Overrides"
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
            onClick={() => resetOverride(frame, node.id, [f])}
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
 * 0114), and, on the page's own instance, its overrides reset or applied to every instance.
 */
export const MainComponentRows = ({
  frame,
  node,
}: {
  frame: string;
  node: InstanceNode;
}) => {
  const canvas = useEditor((s) => s.canvas);
  // The page's own instance holds the overrides of every layer it draws.
  const own = useDocuments((s) => {
    const found = nodeIn(s.docs, canvas, frame, node.id);
    return isInstanceLayer(node.id) || found?.type !== "instance"
      ? null
      : found;
  });
  if (node.from !== APP_FROM) {
    return null;
  }
  const count = Object.keys(own?.overrides ?? {}).length;
  return (
    <>
      <Row label="Main">
        <div className="flex min-w-0 flex-1 gap-1">
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
      {own && count > 0 ? (
        <Row label="Overrides">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <span className="shrink-0 px-2 font-body tabular-nums">
              {count === 1 ? "1 layer" : `${count} layers`}
            </span>
            <Button
              onClick={() => resetOverrides(frame, own.id)}
              size="sm"
              variant="ghost"
            >
              Reset all
            </Button>
            <Button
              onClick={() => applyToMain(frame, own)}
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
