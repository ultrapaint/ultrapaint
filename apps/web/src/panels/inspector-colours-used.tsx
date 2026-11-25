/**
 * The inspector's Colours used: every colour the selection's trees use, a row per value with how
 * many times it is used and a colour field, for a container, an app component's instance or
 * several elements. Its job is the selection's palette, audited and changed as a whole: the
 * sections above it show and set the fields of the nodes selected, this one the colours of
 * everything inside them, so it sits after Appearance, the last of the node's own. Changing a row's value changes every use of it, at every breakpoint and in
 * every instance's overrides, as one undo step; the list is read again from the page as it
 * changes, so two rows made one value are one row.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import { APP_FROM } from "@ultrapaint/contracts/component-names";
import type { DesignNode } from "@ultrapaint/contracts/document";
import {
  type ColourUsed,
  coloursUsed,
} from "@ultrapaint/design-document/colours-used";
import { isContainer } from "@ultrapaint/design-document/tree";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { ValueField } from "../components/value-field.tsx";
import { changeColourUsed } from "../lib/node-actions.ts";
import { Swatch, useColorOf, useTokenOptions } from "../lib/token-options.tsx";
import {
  pickedRoots,
  settledPicks,
  useCanvasPicks,
} from "../state/canvas-picks.ts";
import { rootOfFrame, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";
import { useAppFileOf } from "../state/selection.ts";
import { Row, Section } from "./inspector-fields.tsx";

/**
 * Whether the nodes inspected show Colours used: a container, one app component's instance, whose
 * colours are its overrides', or several. One leaf's colours are its own fields already.
 */
export const showsColoursUsed = (nodes: readonly DesignNode[]): boolean => {
  const [only, ...more] = nodes;
  return (
    only !== undefined &&
    (more.length > 0 ||
      isContainer(only) ||
      (only.type === "instance" && only.from === APP_FROM))
  );
};

/** The ids selected in `frame`, or none when the selection is in another frame too. */
const useSelectedIn = (frame: string): readonly string[] => {
  const { also, selection } = useEditor(
    useShallow((s) => ({ also: s.also, selection: s.selection }))
  );
  const picks = useCanvasPicks(settledPicks);
  const canvas = useEditor((s) => s.canvas);
  // Compared item by item, so a change elsewhere in the documents does not read the colours again.
  return useDocuments(
    useShallow((s) => {
      const targets = selection
        ? [selection, ...also]
        : pickedRoots(picks, s.docs, canvas);
      // The section reads one page: a selection across frames is several.
      return targets.every((t) => t.frame === frame)
        ? targets.map((t) => t.nodeId)
        : [];
    })
  );
};

export const ColoursUsedSection = ({ frame }: { frame: string }) => {
  const ids = useSelectedIn(frame);
  const canvas = useEditor((s) => s.canvas);
  const root = useDocuments((s) => rootOfFrame(s.docs, canvas, frame));
  const fileOf = useAppFileOf();
  const used = useMemo(
    () => (root && ids.length > 0 ? coloursUsed(root, ids, fileOf) : null),
    [fileOf, ids, root]
  );
  if (!used) {
    return null;
  }
  return (
    <Section title="Colours used">
      {used.length === 0 ? (
        <p className="font-body-small text-muted-foreground">
          Nothing here sets a colour.
        </p>
      ) : (
        used.map((colour) => (
          <Row
            key={colour.value}
            label={
              colour.uses.length === 1 ? "1 use" : `${colour.uses.length} uses`
            }
          >
            <ColourUsedField colour={colour} frame={frame} />
          </Row>
        ))
      )}
    </Section>
  );
};

/** A colour used, changed everywhere it is used; never cleared, which would take it off nodes wholesale. */
const ColourUsedField = ({
  colour,
  frame,
}: {
  colour: ColourUsed;
  frame: string;
}) => {
  const options = useTokenOptions("color");
  const swatch = useColorOf(colour.value);
  const change = (value: JsonValue) => {
    if (typeof value === "string" && value !== "" && value !== colour.value) {
      changeColourUsed(frame, colour, value);
    }
  };
  return (
    <ValueField
      accept={(q) => CSS.supports("color", q)}
      clearable={false}
      kind="color"
      leading={<Swatch color={swatch} />}
      onChange={change}
      options={options}
      value={colour.value}
    />
  );
};
