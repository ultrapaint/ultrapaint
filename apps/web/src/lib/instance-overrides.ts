/**
 * What the inspector does with instance overrides (ADR 0114): a layer's field given back to the
 * main component; all of an instance's given back, or made its main component's for every
 * instance, whether the instance is the page's own or one nested in it; and one field made a
 * property of the component, with this instance's value. Each is one request and one undo step,
 * but making a property, which changes the component's file first.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import { APP_FROM } from "@ultrapaint/contracts/component-names";
import {
  type ComponentProperty,
  componentDocOf,
} from "@ultrapaint/contracts/components";
import type {
  DesignNode,
  DocOp,
  InstanceNode,
} from "@ultrapaint/contracts/document";
import {
  asPropertyValue,
  componentLayerOf,
  FIELD_OF_KIND,
  instanceLayerOf,
  LAYER_SEPARATOR,
  layerOwner,
  layerPath,
  overridesAsMainOps,
  throughProperties,
} from "@ultrapaint/design-document/instance-layers";
import {
  findNode,
  isRecord,
  nodeLabel,
} from "@ultrapaint/design-document/tree";
import { promptDialog } from "../components/dialogs.tsx";
import { changeFile, freeName } from "../state/components.ts";
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

/** The documents and the canvas as the editor holds them now. */
const current = () => ({
  canvas: useEditor.getState().canvas,
  docs: useDocuments.getState().docs,
});

/**
 * The instance of the frame's document whose instance overrides hold what `id` changes: the
 * page's own instance, for itself or for any layer or instance drawn inside it, and the key the
 * overrides of `id` start from (empty for the page's instance itself).
 */
export const overriddenOn = (
  frame: string,
  id: string,
  { canvas, docs } = current()
): {
  readonly instance: InstanceNode;
  readonly key: string;
  readonly over: Overrides[string] | undefined;
} | null => {
  const at = instanceLayerOf(id);
  const instance = nodeIn(docs, canvas, frame, at ? at.instance : id);
  if (instance?.type !== "instance") {
    return null;
  }
  const key = at ? at.layer : "";
  return { instance, key, over: instance.overrides?.[key] };
};

/**
 * A field of one layer's instance override, a breakpoint's apart: what the inspector lists and
 * marks. A nested instance's prop is `props.<name>`.
 */
export interface OverriddenField {
  /** The breakpoint it is set from; null for the layer's own. */
  readonly at: string | null;
  readonly field: string;
  readonly value: JsonValue;
}

/** What a nested instance's prop is called among the fields: `props.label`. */
const PROPS = "props.";

/** The fields one set of an instance override sets, a nested instance's props one by one. */
const entriesOf = (
  set: Readonly<Record<string, unknown>>,
  at: string | null
): OverriddenField[] =>
  Object.entries(set).flatMap(([field, value]): OverriddenField[] => {
    if (field === "at") {
      return [];
    }
    if (field === "props" && isRecord(value)) {
      return Object.entries(value).map(([name, prop]) => ({
        at,
        field: `${PROPS}${name}`,
        value: prop as JsonValue,
      }));
    }
    return [{ at, field, value: value as JsonValue }];
  });

/** The fields one layer's instance override sets, its own first, then each breakpoint's. */
export const fieldsOf = (
  over: Overrides[string] | undefined
): OverriddenField[] => {
  if (!over) {
    return [];
  }
  const { at } = over;
  return [
    ...entriesOf(over, null),
    ...(isRecord(at)
      ? Object.entries(at).flatMap(([name, set]) =>
          isRecord(set) ? entriesOf(set, name) : []
        )
      : []),
  ];
};

/** How the inspector names an overridden field: a nested instance's prop by its own name. */
export const fieldName = (field: string) =>
  field.startsWith(PROPS) ? field.slice(PROPS.length) : field;

/** Fields of a layer's instance override given back to the main component, in one undo step. */
export const resetInstanceOverride = (
  frame: string,
  layerId: string,
  fields: readonly Pick<OverriddenField, "at" | "field">[]
) => {
  const sets = new Map<string | null, Record<string, null>>();
  const props = new Map<string | null, Record<string, null>>();
  for (const { at, field } of fields) {
    if (field.startsWith(PROPS)) {
      props.set(at, { ...props.get(at), [fieldName(field)]: null });
    } else {
      sets.set(at, { ...sets.get(at), [field]: null });
    }
  }
  const atOf = (at: string | null) => (at === null ? {} : { at });
  return applyEdits(
    [
      {
        doc: docOfFrame(frame, current().canvas),
        ops: [
          ...[...sets].map(
            ([at, set]): DocOp => ({
              id: layerId,
              op: "update",
              set,
              ...atOf(at),
            })
          ),
          ...[...props].map(
            ([at, given]): DocOp => ({
              id: layerId,
              op: "setProps",
              props: given,
              ...atOf(at),
            })
          ),
        ],
      },
    ],
    fields.length > 1 ? "Reset instance overrides" : "Reset instance override"
  );
};

/**
 * The instance overrides an instance draws with, by their keys from it: all of the page's own
 * instance's, or those of a nested one's layers (`nav/label` as `label`), and the keys they are
 * held under on the page's instance. Its own entry (`nav`) is the instance around it's.
 */
export const overridesOfInstance = (
  frame: string,
  id: string,
  seen = current()
): {
  readonly held: readonly string[];
  readonly owner: InstanceNode;
  readonly overrides: Overrides;
} | null => {
  const found = overriddenOn(frame, id, seen);
  if (!found) {
    return null;
  }
  const all = found.instance.overrides ?? {};
  if (found.key === "") {
    return { held: Object.keys(all), overrides: all, owner: found.instance };
  }
  const prefix = `${found.key}${LAYER_SEPARATOR}`;
  const held = Object.keys(all).filter((key) => key.startsWith(prefix));
  const overrides: Record<string, Overrides[string]> = {};
  for (const key of held) {
    overrides[key.slice(prefix.length)] = all[key] ?? {};
  }
  return { held, overrides, owner: found.instance };
};

/** The page's instance's overrides without `keys`, as its field is then set: null once none. */
const without = (owner: InstanceNode, keys: readonly string[]) => {
  const left = Object.fromEntries(
    Object.entries(owner.overrides ?? {}).filter(([key]) => !keys.includes(key))
  );
  return Object.keys(left).length > 0 ? left : null;
};

/**
 * Every instance override of an instance given back to the main component: the page's own
 * instance's, or a nested instance's layers'.
 */
export const resetInstanceOverrides = (frame: string, id: string) => {
  const found = overridesOfInstance(frame, id);
  if (!found || found.held.length === 0) {
    return Promise.resolve(null);
  }
  return applyEdits(
    [
      {
        doc: docOfFrame(frame, current().canvas),
        ops: [
          {
            id: found.owner.id,
            op: "update",
            set: { overrides: without(found.owner, found.held) },
          },
        ],
      },
    ],
    "Reset all instance overrides"
  );
};

/**
 * An instance's instance overrides made its main component's, for every instance, and taken off
 * it: one undo step over the page and the component's tree. An override of a layer the main
 * component no longer has is taken off with the rest, applied nowhere.
 */
export const applyToMain = (frame: string, instance: InstanceNode) => {
  const file =
    instance.from === APP_FROM ? appFileOf(instance.component) : undefined;
  const found = overridesOfInstance(frame, instance.id);
  if (!(file && found) || found.held.length === 0) {
    return Promise.resolve(null);
  }
  const kept = Object.fromEntries(
    Object.entries(found.overrides).filter(
      ([key]) => layerPath(file.tree, key, appFileOf) !== null
    )
  );
  return applyEdits(
    [
      { doc: componentDocOf(file.name), ops: overridesAsMainOps(kept) },
      {
        doc: docOfFrame(frame, current().canvas),
        ops: [
          {
            id: found.owner.id,
            op: "update",
            set: { overrides: without(found.owner, found.held) },
          },
        ],
      },
    ],
    `Apply to ${file.name}`
  );
};

/** The kind of property that sets a layer's field, when one can: a text, a layer shown, a picture. */
const kindOfField = (field: string): ComponentProperty["kind"] | undefined =>
  Object.entries(FIELD_OF_KIND).find(([, f]) => f === field)?.[0] as
    | ComponentProperty["kind"]
    | undefined;

/** A new property's default: the main component's value of the field it sets, as the property's. */
const defaultOf = (
  kind: ComponentProperty["kind"],
  mainValue: JsonValue | undefined
): JsonValue => {
  if (kind === "boolean") {
    return asPropertyValue(kind, mainValue ?? null);
  }
  return typeof mainValue === "string" ? mainValue : "";
};

/** Whether an overridden field can be made a property: a text, a layer shown, a picture. */
export const canBeProperty = ({ at, field }: OverriddenField) =>
  at === null && kindOfField(field) !== undefined;

/**
 * A layer's overridden field made a property of the component that draws it (ADR 0114): the
 * property's default is the main component's value, and this instance sets it to its own.
 */
export const makeProperty = async (
  frame: string,
  layerId: string,
  { field, value }: OverriddenField
) => {
  const kind = kindOfField(field);
  const { canvas, docs } = current();
  const root = rootOfFrame(docs, canvas, frame);
  const owner = layerOwner(root, layerId, appFileOf);
  const file = owner ? appFileOf(owner.component) : undefined;
  if (!(kind && owner && file)) {
    return;
  }
  const layer = componentLayerOf(layerId);
  const main: DesignNode | null = findNode(file.tree, layer);
  const name = await promptDialog({
    confirmLabel: "Make property",
    defaultValue: freeName(file, main ? nodeLabel(main).toLowerCase() : field),
    description: `Every ${file.name} gets it, at the main component's value; this one keeps its own.`,
    placeholder: "label",
    title: "A property",
  });
  const named = name?.trim();
  if (!named || file.properties.some((p) => p.name === named)) {
    return;
  }
  const property: ComponentProperty = {
    default: defaultOf(
      kind,
      (main as Record<string, JsonValue> | null)?.[field]
    ),
    kind,
    name: named,
    targets: [{ node: layer }],
  };
  // Worked out before the component changes: the field is the layer's instance override until then.
  const ops: DocOp[] = [
    { id: layerId, op: "update", set: { [field]: null } },
    ...throughProperties(
      [
        {
          id: owner.id,
          op: "setProps",
          props: { [named]: asPropertyValue(kind, value) },
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
