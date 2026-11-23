/**
 * What the inspector does with an instance's overrides (ADR 0114): a field given back to the main
 * component, all of an instance's given back, all of them made the main component's for every
 * instance, and one field made a property of the component with this instance's value. Each is
 * one request and one undo step, but making a property, which changes the component's file first.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import { APP_FROM } from "@ultrapaint/contracts/component-names";
import {
  type AppComponentFile,
  type ComponentProperty,
  componentDocOf,
} from "@ultrapaint/contracts/components";
import type { DocOp, InstanceNode } from "@ultrapaint/contracts/document";
import {
  componentLayerOf,
  instanceLayerOf,
  layerOwner,
  overridesAsMainOps,
  throughProperties,
} from "@ultrapaint/design-document/instance-layers";
import { findNode, nodeLabel } from "@ultrapaint/design-document/tree";
import { promptDialog } from "../components/dialogs.tsx";
import { changeFile, freeName } from "../panels/inspector-component.tsx";
import {
  appFileOf,
  applyEdits,
  docOfFrame,
  nodeIn,
  rootOfFrame,
  useDocuments,
} from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";

type Overrides = NonNullable<InstanceNode["overrides"]>;

const now = () => ({
  canvas: useEditor.getState().canvas,
  docs: useDocuments.getState().docs,
});

/** The instance of the frame's document a layer is drawn by, and the layer's key in its overrides. */
export const overriddenOn = (frame: string, layerId: string) => {
  const at = instanceLayerOf(layerId);
  if (!at) {
    return null;
  }
  const { canvas, docs } = now();
  const instance = nodeIn(docs, canvas, frame, at.instance);
  return instance?.type === "instance"
    ? { instance, key: at.layer, over: instance.overrides?.[at.layer] }
    : null;
};

/** The fields of an override, each breakpoint's apart: what the inspector lists and resets. */
export interface OverriddenField {
  /** The breakpoint it is set from; null for the layer's own. */
  readonly at: string | null;
  readonly field: string;
  readonly value: JsonValue;
}

export const fieldsOf = (
  over: Overrides[string] | undefined
): OverriddenField[] => {
  if (!over) {
    return [];
  }
  const { at, ...own } = over as Record<string, JsonValue>;
  const fields: OverriddenField[] = Object.entries(own).map(
    ([field, value]) => ({ at: null, field, value })
  );
  if (at && typeof at === "object" && !Array.isArray(at)) {
    for (const [name, set] of Object.entries(at)) {
      if (set && typeof set === "object" && !Array.isArray(set)) {
        for (const [field, value] of Object.entries(set)) {
          fields.push({ at: name, field, value });
        }
      }
    }
  }
  return fields;
};

/** Fields of a layer given back to the main component, in one undo step. */
export const resetOverride = (
  frame: string,
  layerId: string,
  fields: readonly Pick<OverriddenField, "at" | "field">[]
) => {
  const byAt = new Map<string | null, Record<string, null>>();
  for (const { at, field } of fields) {
    byAt.set(at, { ...byAt.get(at), [field]: null });
  }
  return applyEdits(
    [
      {
        doc: docOfFrame(frame, now().canvas),
        ops: [...byAt].map(
          ([at, set]): DocOp => ({
            id: layerId,
            op: "update",
            set,
            ...(at !== null && { at }),
          })
        ),
      },
    ],
    fields.length > 1 ? "Reset overrides" : "Reset override"
  );
};

/** Every override of an instance of the frame's document given back to the main component. */
export const resetOverrides = (frame: string, instance: string) =>
  applyEdits(
    [
      {
        doc: docOfFrame(frame, now().canvas),
        ops: [{ id: instance, op: "update", set: { overrides: null } }],
      },
    ],
    "Reset all overrides"
  );

/**
 * An instance's overrides made its main component's, for every instance, and taken off it: one
 * undo step over the page and the component's tree.
 */
export const applyToMain = (frame: string, instance: InstanceNode) => {
  const { overrides } = instance;
  if (!(overrides && instance.from === APP_FROM)) {
    return Promise.resolve(null);
  }
  return applyEdits(
    [
      {
        doc: componentDocOf(instance.component),
        ops: overridesAsMainOps(overrides),
      },
      {
        doc: docOfFrame(frame, now().canvas),
        ops: [{ id: instance.id, op: "update", set: { overrides: null } }],
      },
    ],
    `Apply to ${instance.component}`
  );
};

/** The kind of property a layer's field can be, by the field. */
const KIND_OF_FIELD: Readonly<Record<string, ComponentProperty["kind"]>> = {
  hidden: "boolean",
  src: "image",
  text: "text",
};

/** A new property's default: the main component's value of the field it sets. */
const defaultOf = (
  kind: ComponentProperty["kind"],
  mainValue: JsonValue | undefined
): JsonValue => {
  if (kind === "boolean") {
    return mainValue !== true;
  }
  return typeof mainValue === "string" ? mainValue : "";
};

/** Whether an overridden field can be made a property: a text, a layer shown, a picture. */
export const canBeProperty = ({ at, field }: OverriddenField) =>
  at === null && field in KIND_OF_FIELD;

/**
 * A layer's overridden field made a property of the component that draws it (ADR 0114): the
 * property's default is the main component's value, and this instance sets it to its own.
 */
export const makeProperty = async (
  frame: string,
  layerId: string,
  { field, value }: OverriddenField
) => {
  const kind = KIND_OF_FIELD[field];
  const { canvas, docs } = now();
  const root = rootOfFrame(docs, canvas, frame);
  const owner = layerOwner(root, layerId, appFileOf);
  const file: AppComponentFile | undefined = owner
    ? appFileOf(owner.component)
    : undefined;
  if (!(kind && owner && file)) {
    return;
  }
  const layer = componentLayerOf(layerId);
  const main = findNode(file.tree, layer) as Record<string, JsonValue> | null;
  const name = await promptDialog({
    confirmLabel: "Make property",
    defaultValue: freeName(
      file,
      main ? nodeLabel(main as never).toLowerCase() : field
    ),
    description: `Every ${file.name} gets it, at the main component's value; this one keeps its own.`,
    placeholder: "label",
    title: "A property",
  });
  const named = name?.trim();
  if (!named || file.properties.some((p) => p.name === named)) {
    return;
  }
  const property: ComponentProperty = {
    default: defaultOf(kind, main?.[field]),
    kind,
    name: named,
    targets: [{ node: layer }],
  };
  // Worked out before the component changes: the field is the layer's override until then.
  const ops: DocOp[] = [
    { id: layerId, op: "update", set: { [field]: null } },
    ...throughProperties(
      [
        {
          id: owner.id,
          op: "setProps",
          props: { [named]: kind === "boolean" ? value !== true : value },
        },
      ],
      root,
      appFileOf
    ),
  ];
  if (await changeFile(file, { op: "addProperty", property })) {
    await applyEdits(
      [{ doc: docOfFrame(frame, canvas), ops }],
      `Make ${named} a property`
    );
  }
};
