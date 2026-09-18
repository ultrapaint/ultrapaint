import type { JsonValue } from "@ultrapaint/contracts/base";
import type { ElementSource } from "@ultrapaint/contracts/edit";
import type { InspectResult, StyleValue } from "@ultrapaint/contracts/preview";
import {
  arbitrary,
  fontSizeScale,
  fontWeightScale,
  leadingScale,
  propertyToUtility,
  pxToSpacing,
  radiusScale,
  shadowScale,
  spacingScale,
  spacingToPx,
  trackingScale,
} from "@ultrapaint/shared/tailwind";
import { cn } from "cn";
import {
  AlignCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceBetween,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowRight,
  ChevronRight,
  Lock,
  StretchHorizontal,
} from "lucide-react";
import type * as React from "react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { bridgeFor } from "../canvas/bridge.ts";
import { PanelEmpty, Row, Section } from "../components/panel.tsx";
import { Segmented } from "../components/segmented.tsx";
import {
  ArbitraryDot,
  isArbitraryClass,
  StyleCombobox,
  type StyleOption,
} from "../components/style-combobox.tsx";
import { runEdit } from "../lib/shortcuts.ts";
import { api } from "../state/connection.ts";
import { useEditor } from "../state/editor.ts";
import { ComponentProps } from "./component-props.tsx";

const px = (v: string | undefined) => {
  if (!v) {
    return "";
  }
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : v;
};

const COLOR_TOKEN_PREFIX_RE = /^--(ds|color)-/;
const COLOR_UTILITY_RE =
  /\d|^(foreground|muted|background|border|surface|brand|solid)/;
const FONT_TOKEN_PREFIX_RE = /^--font-/;
const WHITESPACE_RE = /\s+/;
const PLAIN_NUMBER_RE = /^-?\d*\.?\d+(px)?$/;
const FRACTION_RE = /^\d+\/\d+$/;

/**
 * Where a value comes from, shown muted next to its control: the class, token or inline style
 * behind it. Browser defaults and inherited values say nothing worth the space.
 */
const provHint = (s: StyleValue | undefined): string | undefined => {
  const p = s?.provenance;
  if (!p) {
    return;
  }
  if (p.kind === "utility" || p.kind === "component") {
    return p.className;
  }
  if (p.kind === "token") {
    return p.token;
  }
  return p.kind === "inline" ? "inline style" : undefined;
};

const valueTitle = (prop: string, s: StyleValue | undefined) => {
  const hint = provHint(s);
  return `${prop}: ${s?.value ?? ""}${hint ? ` · ${hint}` : ""}`;
};

const removalFor = (s: StyleValue | undefined): string[] =>
  s?.provenance.kind === "utility" && s.provenance.className
    ? [s.provenance.className]
    : [];

const classForValue = (
  util: { prefix: string; scale?: string },
  raw: string
): string | null => {
  const v = raw.trim();
  if (v === "auto") {
    return `${util.prefix}-auto`;
  }
  if (v === "full" || v === "100%") {
    return `${util.prefix}-full`;
  }
  if (v === "screen") {
    return `${util.prefix}-screen`;
  }
  if (v === "fit" || v === "fit-content") {
    return `${util.prefix}-fit`;
  }
  if (v === "none") {
    return `${util.prefix}-none`;
  }
  if (FRACTION_RE.test(v)) {
    return `${util.prefix}-${v}`;
  }
  if (!PLAIN_NUMBER_RE.test(v)) {
    return arbitrary(util.prefix, v);
  }
  const n = Number.parseFloat(v);
  if (
    util.scale === "spacing" ||
    util.scale === "width" ||
    util.scale === "height"
  ) {
    const step = pxToSpacing(n);
    if (step !== null) {
      return `${util.prefix}-${step}`;
    }
    return arbitrary(util.prefix, `${n}px`);
  }
  if (
    util.scale === "font-size" ||
    util.scale === "leading" ||
    util.scale === "tracking"
  ) {
    return arbitrary(util.prefix, `${n}px`);
  }
  if (util.scale === "font-weight") {
    return arbitrary(util.prefix, String(n));
  }
  if (util.scale === "opacity") {
    return `${util.prefix}-${Math.round(n)}`;
  }
  if (util.prefix === "border") {
    return n === 1 ? "border" : `border-${Math.round(n)}`;
  }
  return arbitrary(util.prefix, `${n}px`);
};

/**
 * Turns what was typed into a class. A number goes through the scale first; anything else becomes
 * an arbitrary value, offered only once it is valid CSS for the property so half-typed queries
 * don't suggest junk.
 */
const customFor =
  (prop: string, util: { prefix: string; scale?: string }) =>
  (query: string): string | null => {
    const cls = classForValue(util, query);
    if (
      cls &&
      isArbitraryClass(cls) &&
      !PLAIN_NUMBER_RE.test(query) &&
      !CSS.supports(prop, query.trim())
    ) {
      return null;
    }
    return cls;
  };

const SIZE_KEYWORDS = [
  "auto",
  "full",
  "screen",
  "fit",
  "min",
  "max",
  "1/2",
  "1/3",
  "2/3",
  "1/4",
  "3/4",
];
const CONTAINER_SCALE = [
  "3xs",
  "2xs",
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
  "7xl",
  "prose",
];

/** Scale steps a px property can take: spacing labelled in px, plus keywords for sizes. */
const pxOptions = (util: { prefix: string; scale?: string }): StyleOption[] => {
  const { prefix, scale } = util;
  const keyword = (v: string): StyleOption => ({
    label: v,
    value: `${prefix}-${v}`,
  });
  const steps = spacingScale.map((step) => ({
    label: String(spacingToPx(step)),
    value: `${prefix}-${step}`,
  }));
  if (scale !== "width" && scale !== "height") {
    return prefix.startsWith("m") ? [keyword("auto"), ...steps] : steps;
  }
  return [
    ...(prefix.startsWith("max-") ? [keyword("none")] : []),
    ...(prefix === "max-w" ? CONTAINER_SCALE.map(keyword) : []),
    ...SIZE_KEYWORDS.map(keyword),
    ...steps,
  ];
};

/** Size or spacing field: the spacing scale in px, with arbitrary px values as the fallback. */
const PxField = ({
  prop,
  styles,
  onClass,
  disabled,
  short,
}: {
  prop: string;
  styles: Record<string, StyleValue>;
  onClass: (add: string[], remove: string[]) => void;
  disabled: boolean;
  short?: string;
}) => {
  const s = styles[prop];
  const util = propertyToUtility[prop];
  if (!util) {
    return null;
  }
  const onPick = (cls: string) => onClass([cls], removalFor(s));
  return (
    <StyleCombobox
      current={s?.provenance.className}
      custom={customFor(prop, util)}
      disabled={disabled}
      display={px(s?.value)}
      leading={short ? <span className="w-2.5">{short}</span> : undefined}
      onPick={onPick}
      options={pxOptions(util)}
      title={valueTitle(prop, s)}
    />
  );
};

interface TokenOption {
  description?: string;
  label: string;
  preview?: ReactNode;
  value: string;
}

const colorOption = (
  name: string,
  value: string,
  existing: readonly TokenOption[]
): TokenOption | null => {
  if (!(name.startsWith("--ds-") || name.startsWith("--color-"))) {
    return null;
  }
  const util = name.replace(COLOR_TOKEN_PREFIX_RE, "");
  if (!COLOR_UTILITY_RE.test(util)) {
    return null;
  }
  if (existing.find((o) => o.value === util)) {
    return null;
  }
  return {
    label: util,
    preview: <Swatch color={value} />,
    value: util,
  };
};

const fontOption = (name: string, value: string): TokenOption | null => {
  if (!name.startsWith("--font-")) {
    return null;
  }
  const util = name.replace(FONT_TOKEN_PREFIX_RE, "");
  // Skip Tailwind's per-family sub-properties (`--font-sans--font-feature-settings`) and the
  // font-weight scale (`--font-weight-bold`), which shares the prefix but is not a family.
  if (util.includes("--") || util.startsWith("weight-")) {
    return null;
  }
  return {
    description: value.split(",")[0]?.replaceAll('"', ""),
    label: util,
    value: util,
  };
};

const useTokenOptions = (kind: "color" | "font") => {
  const tokens = useEditor((s) => s.tokens);
  const out: TokenOption[] = [];
  for (const [name, value] of Object.entries(tokens)) {
    const option =
      kind === "color"
        ? colorOption(name, value, out)
        : fontOption(name, value);
    if (option) {
      out.push(option);
    }
  }
  return out.sort((a, b) => a.value.localeCompare(b.value));
};

const Swatch = ({
  color,
  className,
}: {
  color?: string;
  className?: string;
}) => (
  <span
    className={cn("size-3 shrink-0 rounded-sm border border-input", className)}
    style={{ background: color }}
  />
);

const ColorField = ({
  prop,
  prefix,
  styles,
  onClass,
  disabled,
}: {
  prop: string;
  prefix: string;
  styles: Record<string, StyleValue>;
  onClass: (add: string[], remove: string[]) => void;
  disabled: boolean;
}) => {
  const s = styles[prop];
  const options = useTokenOptions("color");
  const recent = useRecent("color");
  const ordered = [
    ...recent
      .map((r) => options.find((o) => o.value === r))
      .filter((o) => o !== undefined),
    ...options.filter((o) => !recent.includes(o.value)),
  ];
  const onPick = (cls: string) => {
    if (!isArbitraryClass(cls)) {
      recent.push(cls.slice(prefix.length + 1));
    }
    onClass([cls], removalFor(s));
  };
  const custom = (query: string) =>
    CSS.supports("color", query.trim())
      ? arbitrary(prefix, query.trim())
      : null;
  return (
    <StyleCombobox
      current={s?.provenance.className}
      custom={custom}
      disabled={disabled}
      display={s?.value ?? ""}
      hint={provHint(s)}
      leading={<Swatch color={s?.value} />}
      onPick={onPick}
      options={ordered.map((o) => ({ ...o, value: `${prefix}-${o.value}` }))}
      title={valueTitle(prop, s)}
    />
  );
};

const recents: Record<string, string[]> = {};
const useRecent = (key: string) => {
  if (!recents[key]) {
    recents[key] = JSON.parse(
      localStorage.getItem(`ultrapaint:recent:${key}`) ?? "[]"
    ) as string[];
  }
  const list = recents[key] as string[];
  return Object.assign(list, {
    push: (v: string) => {
      const idx = list.indexOf(v);
      if (idx >= 0) {
        list.splice(idx, 1);
      }
      list.unshift(v);
      list.splice(6);
      localStorage.setItem(`ultrapaint:recent:${key}`, JSON.stringify(list));
    },
  });
};

/**
 * Named steps of a theme scale: Tailwind's defaults, plus whatever the project defines under the
 * same token namespace (`--text-display`), described by the token's value.
 */
const useScaleOptions = (
  prefix: string,
  scale: readonly string[],
  namespace: string | undefined,
  labels: ((v: string) => string) | undefined
): StyleOption[] => {
  const tokens = useEditor((s) => s.tokens);
  const steps = [...scale];
  if (namespace) {
    for (const name of Object.keys(tokens)) {
      const step = name.slice(namespace.length + 3);
      if (
        name.startsWith(`--${namespace}-`) &&
        !step.includes("--") &&
        !steps.includes(step)
      ) {
        steps.push(step);
      }
    }
  }
  return steps.map((v) => ({
    description: namespace ? tokens[`--${namespace}-${v}`] : undefined,
    label: labels ? labels(v) : v,
    value: v === "" ? prefix : `${prefix}-${v}`,
  }));
};

const ScaleSelect = ({
  prop,
  prefix,
  scale,
  tokens,
  styles,
  onClass,
  disabled,
  labels,
}: {
  prop: string;
  prefix: string;
  scale: readonly string[];
  /** Theme namespace whose tokens extend the scale, e.g. `text` for `--text-*`. */
  tokens?: string;
  styles: Record<string, StyleValue>;
  onClass: (add: string[], remove: string[]) => void;
  disabled: boolean;
  labels?: (v: string) => string;
}) => {
  const s = styles[prop];
  const options = useScaleOptions(prefix, scale, tokens, labels);
  const onPick = (cls: string) => onClass([cls], removalFor(s));
  return (
    <StyleCombobox
      current={s?.provenance.className}
      custom={customFor(prop, propertyToUtility[prop] ?? { prefix })}
      disabled={disabled}
      display={px(s?.value)}
      hint={provHint(s)}
      onPick={onPick}
      options={options}
      title={valueTitle(prop, s)}
    />
  );
};

export const Inspector = () => {
  const selection = useEditor((s) => s.selection);
  const inspect = useEditor((s) => s.inspect);
  const tree = useEditor((s) =>
    selection ? s.trees[selection.pageId] : undefined
  );
  const [loadedSource, setLoadedSource] = useState<ElementSource | null>(null);
  // Only meaningful while the selection points at source; derived instead of reset from the effect.
  const hasSource = Boolean(selection?.source);
  const source = hasSource && tree ? loadedSource : null;
  const requestSeq = useRef(0);

  // Load inspection + source whenever selection or tree changes (tree changes after HMR).
  useEffect(() => {
    if (!(selection && tree)) {
      useEditor.getState().setInspect(null);
      return;
    }
    requestSeq.current += 1;
    const seq = requestSeq.current;
    const bridge = bridgeFor(selection.pageId);
    bridge.inspect(selection.nodeId).then((r) => {
      if (seq === requestSeq.current) {
        useEditor.getState().setInspect(r);
      }
    });
    if (selection.source) {
      api()
        .request("source.element", selection.source)
        .then((s) => {
          if (seq === requestSeq.current) {
            setLoadedSource(s);
          }
        })
        .catch(() => setLoadedSource(null));
    }
  }, [selection, tree]);

  const target = selection?.source ?? null;
  const onClass = (add: string[], remove: string[]) => {
    if (!target) {
      return;
    }
    runEdit({ add, kind: "setClasses", remove, target });
  };
  const setAttr = (name: string, value: JsonValue) => {
    if (!target) {
      return;
    }
    runEdit({
      kind: "setAttribute",
      name,
      target,
      value,
    });
  };

  if (!selection) {
    return (
      <PanelEmpty>
        Select an element on the canvas or in the layers panel
      </PanelEmpty>
    );
  }
  if (!inspect) {
    return <PanelEmpty>Inspecting…</PanelEmpty>;
  }

  const editable = inspect.editable && !!selection.source;
  const { styles } = inspect;

  return (
    <div className="flex flex-col pb-8">
      <Header inspect={inspect} source={source} />
      {!editable && <NotEditable inspect={inspect} />}
      {inspect.kind === "component" && (
        <ComponentProps
          disabled={!editable}
          inspect={inspect}
          onSet={setAttr}
          source={source}
        />
      )}

      <Section title="Layout">
        <Row label="Display">
          <DisplaySelect
            disabled={!editable}
            onClass={onClass}
            styles={styles}
          />
        </Row>
        {(styles.display?.value.includes("flex") ||
          styles.display?.value.includes("grid")) && (
          <>
            <Row label="Direction">
              <ClassSegmented
                classFor={directionClass}
                disabled={!editable}
                onClass={onClass}
                options={[
                  {
                    label: <ArrowRight className="size-3" />,
                    title: "row",
                    value: "row",
                  },
                  {
                    label: <ArrowDown className="size-3" />,
                    title: "column",
                    value: "column",
                  },
                ]}
                prop="flex-direction"
                styles={styles}
              />
              <ClassSegmented
                classFor={wrapClass}
                disabled={!editable}
                onClass={onClass}
                options={[
                  { label: "no wrap", value: "nowrap" },
                  { label: "wrap", value: "wrap" },
                ]}
                prop="flex-wrap"
                styles={styles}
              />
            </Row>
            <Row label="Align">
              <ClassSegmented
                classFor={alignItemsClass}
                disabled={!editable}
                onClass={onClass}
                options={[
                  {
                    label: (
                      <AlignHorizontalJustifyStart className="size-3 rotate-90" />
                    ),
                    title: "start",
                    value: "flex-start",
                  },
                  {
                    label: (
                      <AlignHorizontalJustifyCenter className="size-3 rotate-90" />
                    ),
                    title: "center",
                    value: "center",
                  },
                  {
                    label: (
                      <AlignHorizontalJustifyEnd className="size-3 rotate-90" />
                    ),
                    title: "end",
                    value: "flex-end",
                  },
                  {
                    label: <StretchHorizontal className="size-3" />,
                    title: "stretch",
                    value: "stretch",
                  },
                ]}
                prop="align-items"
                styles={styles}
              />
            </Row>
            <Row label="Justify">
              <ClassSegmented
                classFor={justifyContentClass}
                disabled={!editable}
                onClass={onClass}
                options={[
                  {
                    label: <AlignHorizontalJustifyStart className="size-3" />,
                    title: "start",
                    value: "flex-start",
                  },
                  {
                    label: <AlignHorizontalJustifyCenter className="size-3" />,
                    title: "center",
                    value: "center",
                  },
                  {
                    label: <AlignHorizontalJustifyEnd className="size-3" />,
                    title: "end",
                    value: "flex-end",
                  },
                  {
                    label: <AlignHorizontalSpaceBetween className="size-3" />,
                    title: "between",
                    value: "space-between",
                  },
                ]}
                prop="justify-content"
                styles={styles}
              />
            </Row>
            <Row label="Gap">
              <PxField
                disabled={!editable}
                onClass={onClass}
                prop="row-gap"
                short="↕"
                styles={styles}
              />
              <PxField
                disabled={!editable}
                onClass={onClass}
                prop="column-gap"
                short="↔"
                styles={styles}
              />
            </Row>
          </>
        )}
      </Section>

      <Section title="Size">
        <Row label="Size">
          <PxField
            disabled={!editable}
            onClass={onClass}
            prop="width"
            short="W"
            styles={styles}
          />
          <PxField
            disabled={!editable}
            onClass={onClass}
            prop="height"
            short="H"
            styles={styles}
          />
        </Row>
        <Row label="Min">
          <PxField
            disabled={!editable}
            onClass={onClass}
            prop="min-width"
            short="W"
            styles={styles}
          />
          <PxField
            disabled={!editable}
            onClass={onClass}
            prop="min-height"
            short="H"
            styles={styles}
          />
        </Row>
        <Row label="Max">
          <PxField
            disabled={!editable}
            onClass={onClass}
            prop="max-width"
            short="W"
            styles={styles}
          />
          <PxField
            disabled={!editable}
            onClass={onClass}
            prop="max-height"
            short="H"
            styles={styles}
          />
        </Row>
      </Section>

      <Section title="Spacing">
        <Row label="Padding">
          <PxField
            disabled={!editable}
            onClass={onClass}
            prop="padding-top"
            short="T"
            styles={styles}
          />
          <PxField
            disabled={!editable}
            onClass={onClass}
            prop="padding-right"
            short="R"
            styles={styles}
          />
        </Row>
        <Row label="">
          <PxField
            disabled={!editable}
            onClass={onClass}
            prop="padding-bottom"
            short="B"
            styles={styles}
          />
          <PxField
            disabled={!editable}
            onClass={onClass}
            prop="padding-left"
            short="L"
            styles={styles}
          />
        </Row>
        <Row label="Margin">
          <PxField
            disabled={!editable}
            onClass={onClass}
            prop="margin-top"
            short="T"
            styles={styles}
          />
          <PxField
            disabled={!editable}
            onClass={onClass}
            prop="margin-right"
            short="R"
            styles={styles}
          />
        </Row>
        <Row label="">
          <PxField
            disabled={!editable}
            onClass={onClass}
            prop="margin-bottom"
            short="B"
            styles={styles}
          />
          <PxField
            disabled={!editable}
            onClass={onClass}
            prop="margin-left"
            short="L"
            styles={styles}
          />
        </Row>
      </Section>

      <Section title="Typography">
        <Row label="Family">
          <FontSelect disabled={!editable} onClass={onClass} styles={styles} />
        </Row>
        <Row label="Size">
          <ScaleSelect
            disabled={!editable}
            onClass={onClass}
            prefix="text"
            prop="font-size"
            scale={fontSizeScale}
            styles={styles}
            tokens="text"
          />
        </Row>
        <Row label="Weight">
          <ScaleSelect
            disabled={!editable}
            onClass={onClass}
            prefix="font"
            prop="font-weight"
            scale={fontWeightScale}
            styles={styles}
            tokens="font-weight"
          />
        </Row>
        <Row label="Line height">
          <ScaleSelect
            disabled={!editable}
            onClass={onClass}
            prefix="leading"
            prop="line-height"
            scale={leadingScale}
            styles={styles}
            tokens="leading"
          />
        </Row>
        <Row label="Tracking">
          <ScaleSelect
            disabled={!editable}
            onClass={onClass}
            prefix="tracking"
            prop="letter-spacing"
            scale={trackingScale}
            styles={styles}
            tokens="tracking"
          />
        </Row>
        <Row label="Align">
          <ClassSegmented
            classFor={textAlignClass}
            disabled={!editable}
            onClass={onClass}
            options={[
              { label: <AlignLeft className="size-3" />, value: "start" },
              { label: <AlignCenter className="size-3" />, value: "center" },
              { label: <AlignRight className="size-3" />, value: "end" },
            ]}
            prop="text-align"
            styles={styles}
          />
        </Row>
      </Section>

      <Section title="Colour">
        <Row label="Text">
          <ColorField
            disabled={!editable}
            onClass={onClass}
            prefix="text"
            prop="color"
            styles={styles}
          />
        </Row>
        <Row label="Background">
          <ColorField
            disabled={!editable}
            onClass={onClass}
            prefix="bg"
            prop="background-color"
            styles={styles}
          />
        </Row>
      </Section>

      <Section title="Border">
        <Row label="Width">
          <ScaleSelect
            disabled={!editable}
            labels={borderWidthLabel}
            onClass={onClass}
            prefix="border"
            prop="border-top-width"
            scale={["0", "", "2", "4", "8"]}
            styles={styles}
          />
        </Row>
        <Row label="Colour">
          <ColorField
            disabled={!editable}
            onClass={onClass}
            prefix="border"
            prop="border-top-color"
            styles={styles}
          />
        </Row>
        <Row label="Radius">
          <ScaleSelect
            disabled={!editable}
            onClass={onClass}
            prefix="rounded"
            prop="border-top-left-radius"
            scale={radiusScale}
            styles={styles}
            tokens="radius"
          />
        </Row>
      </Section>

      <Section title="Effects">
        <Row label="Opacity">
          <OpacityField
            disabled={!editable}
            onClass={onClass}
            styles={styles}
          />
        </Row>
        <Row label="Shadow">
          <ScaleSelect
            disabled={!editable}
            onClass={onClass}
            prefix="shadow"
            prop="box-shadow"
            scale={shadowScale}
            styles={styles}
            tokens="shadow"
          />
        </Row>
      </Section>

      {source ? (
        <Section title="Classes">
          <ClassEditor
            disabled={!editable}
            inspect={inspect}
            onClass={onClass}
            source={source}
          />
        </Section>
      ) : null}
    </div>
  );
};

const displayOptions: StyleOption[] = [
  "block",
  "flex",
  "inline-flex",
  "grid",
  "inline-grid",
  "inline",
  "inline-block",
  "flow-root",
  "contents",
  "table",
  "none",
].map((v) => ({ label: v, value: v === "none" ? "hidden" : v }));

/** Display is a closed set of keywords, all listed, so it takes no arbitrary value. */
const DisplaySelect = ({
  styles,
  onClass,
  disabled,
}: {
  styles: Record<string, StyleValue>;
  onClass: (a: string[], r: string[]) => void;
  disabled: boolean;
}) => {
  const s = styles.display;
  const onPick = (cls: string) => onClass([cls], removalFor(s));
  return (
    <StyleCombobox
      current={s?.provenance.className}
      disabled={disabled}
      display={s?.value ?? ""}
      hint={provHint(s)}
      onPick={onPick}
      options={displayOptions}
      title={valueTitle("display", s)}
    />
  );
};

const directionClass = (v: string) => (v === "row" ? "flex-row" : "flex-col");
const wrapClass = (v: string) => (v === "wrap" ? "flex-wrap" : "flex-nowrap");
const alignItemsClass = (v: string) =>
  ({
    center: "items-center",
    "flex-end": "items-end",
    "flex-start": "items-start",
    stretch: "items-stretch",
  })[v] as string;
const justifyContentClass = (v: string) =>
  ({
    center: "justify-center",
    "flex-end": "justify-end",
    "flex-start": "justify-start",
    "space-between": "justify-between",
  })[v] as string;
const textAlignClass = (v: string) =>
  ({
    center: "text-center",
    end: "text-right",
    start: "text-left",
  })[v] as string;

const borderWidthLabel = (v: string) => (v === "" ? "1" : v);

/** Segmented control over a CSS property that writes the class picked by `classFor`. */
const ClassSegmented = ({
  prop,
  classFor,
  options,
  styles,
  onClass,
  disabled,
}: {
  prop: string;
  classFor: (v: string) => string;
  options: { value: string; label: ReactNode; title?: string }[];
  styles: Record<string, StyleValue>;
  onClass: (a: string[], r: string[]) => void;
  disabled: boolean;
}) => {
  const s = styles[prop];
  const onChange = (v: string) => onClass([classFor(v)], removalFor(s));
  return (
    <Segmented
      disabled={disabled}
      onChange={onChange}
      options={options}
      value={s?.value ?? null}
    />
  );
};

const opacityOptions: StyleOption[] = Array.from({ length: 21 }, (_, i) => ({
  label: `${i * 5}%`,
  value: `opacity-${i * 5}`,
}));

const OpacityField = ({
  styles,
  onClass,
  disabled,
}: {
  styles: Record<string, StyleValue>;
  onClass: (a: string[], r: string[]) => void;
  disabled: boolean;
}) => {
  const s = styles.opacity;
  const onPick = (cls: string) => onClass([cls], removalFor(s));
  const custom = (query: string) => {
    const n = Number(query.trim().replace("%", ""));
    if (!(query.trim() && Number.isFinite(n))) {
      return null;
    }
    return `opacity-${Math.min(100, Math.max(0, Math.round(n)))}`;
  };
  return (
    <StyleCombobox
      className="w-24 flex-none"
      current={s?.provenance.className}
      custom={custom}
      disabled={disabled}
      display={`${Math.round(Number.parseFloat(s?.value ?? "1") * 100)}%`}
      onPick={onPick}
      options={opacityOptions}
      title={valueTitle("opacity", s)}
    />
  );
};

const FontSelect = ({
  styles,
  onClass,
  disabled,
}: {
  styles: Record<string, StyleValue>;
  onClass: (a: string[], r: string[]) => void;
  disabled: boolean;
}) => {
  const options = useTokenOptions("font").map((o) => ({
    ...o,
    value: `font-${o.value}`,
  }));
  const s = styles["font-family"];
  const onPick = (cls: string) => onClass([cls], removalFor(s));
  const custom = (query: string) =>
    CSS.supports("font-family", query.trim())
      ? arbitrary("font", `family-name:${query.trim()}`)
      : null;
  return (
    <StyleCombobox
      current={s?.provenance.className}
      custom={custom}
      disabled={disabled}
      display={s?.value.split(",")[0]?.replaceAll('"', "") ?? ""}
      hint={provHint(s)}
      onPick={onPick}
      options={options}
      title={valueTitle("font-family", s)}
    />
  );
};

const OwnClassBadge = ({
  name,
  onClass,
  disabled,
}: {
  name: string;
  onClass: (a: string[], r: string[]) => void;
  disabled: boolean;
}) => {
  const remove = () => onClass([], [name]);
  return (
    <Badge
      className="rounded-sm bg-brand/20 px-1.5 font-mono text-brand hover:bg-destructive/20 hover:text-destructive disabled:pointer-events-none"
      onClick={remove}
      render={<button disabled={disabled} type="button" />}
      title={
        isArbitraryClass(name)
          ? "Arbitrary value, outside the design system. Click to remove."
          : "Remove"
      }
    >
      {isArbitraryClass(name) ? <ArbitraryDot /> : null}
      {name}
    </Badge>
  );
};

const ClassEditor = ({
  source,
  inspect,
  onClass,
  disabled,
}: {
  source: ElementSource;
  inspect: InspectResult;
  onClass: (a: string[], r: string[]) => void;
  disabled: boolean;
}) => {
  const [draft, setDraft] = useState("");
  const own = source.className?.split(WHITESPACE_RE).filter(Boolean) ?? [];
  const inherited = inspect.classes.filter((c) => !own.includes(c));
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft(e.target.value);
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && draft.trim()) {
      onClass(draft.trim().split(WHITESPACE_RE), []);
      setDraft("");
    }
  };
  return (
    <>
      <div className="flex flex-wrap gap-1">
        {own.map((c) => (
          <OwnClassBadge
            disabled={disabled}
            key={c}
            name={c}
            onClass={onClass}
          />
        ))}
        {own.length === 0 && (
          <span className="text-muted-foreground">
            No classes on this element
          </span>
        )}
      </div>
      <Input
        className="h-6 font-mono md:text-[11px]"
        disabled={disabled}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder="Add classes…"
        value={draft}
      />
      {inherited.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger
            render={
              <Button
                className="-ml-2 text-muted-foreground"
                size="xs"
                variant="ghost"
              />
            }
          >
            <ChevronRight className="transition-transform group-data-panel-open/button:rotate-90" />
            {inherited.length} classes from the component
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1 flex flex-wrap gap-1">
            {inherited.map((c) => (
              <Badge
                className="rounded-sm px-1.5 font-mono"
                key={c}
                variant="secondary"
              >
                {c}
              </Badge>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </>
  );
};

const Header = ({
  inspect,
  source,
}: {
  inspect: InspectResult;
  source: ElementSource | null;
}) => (
  <div className="flex flex-col gap-0.5 border-b px-3 py-2.5">
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "font-semibold text-sm",
          inspect.kind === "component" && "text-brand"
        )}
      >
        {inspect.name}
      </span>
      <span className="text-muted-foreground">
        {Math.round(inspect.rect.width)} × {Math.round(inspect.rect.height)}
      </span>
    </div>
    {inspect.source ? (
      <span
        className="truncate font-mono text-[10px] text-muted-foreground"
        title={`${inspect.source.file}:${inspect.source.line}:${inspect.source.col}`}
      >
        {inspect.source.file.split("/").slice(-2).join("/")}:
        {inspect.source.line}
      </span>
    ) : null}
    {source?.text !== null && source?.text !== undefined && (
      <span className="truncate text-muted-foreground">“{source.text}”</span>
    )}
  </div>
);

const NotEditable = ({ inspect }: { inspect: InspectResult }) => {
  const ancestor = inspect.editableAncestor;
  const selectAncestor = () => {
    const s = useEditor.getState();
    if (!(s.selection && ancestor)) {
      return;
    }
    s.select({
      nodeId: ancestor.nodeId,
      pageId: s.selection.pageId,
      source: ancestor.source,
    });
  };
  return (
    <div className="border-b p-2">
      <Alert>
        <Lock />
        <AlertDescription className="flex flex-col gap-1.5">
          <span>
            This element comes from{" "}
            <span className="font-mono text-[10px] text-foreground">
              {inspect.source
                ? inspect.source.file
                : "code outside the stamped directories"}
            </span>
            , not from a page file, so its values are read-only here.
          </span>
          {inspect.editableAncestor ? (
            <Button
              className="self-start"
              onClick={selectAncestor}
              size="sm"
              variant="outline"
            >
              Select {inspect.editableAncestor.name} instead
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
    </div>
  );
};
