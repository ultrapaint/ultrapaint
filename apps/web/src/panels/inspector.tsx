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
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { bridgeFor } from "../canvas/bridge.ts";
import { promptDialog } from "../components/dialogs.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { PanelEmpty, Row, Section } from "../components/panel.tsx";
import { Segmented } from "../components/segmented.tsx";
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

const provLabel = (p: StyleValue["provenance"]) => {
  if (p.kind === "utility" || p.kind === "component") {
    return p.className;
  }
  return p.kind === "token" ? p.token : p.kind;
};

const provVariant = (p: StyleValue["provenance"]) => {
  if (p.kind === "inline") {
    return "destructive";
  }
  return p.kind === "component" ? "secondary" : "ghost";
};

const Prov = ({ s }: { s: StyleValue | undefined }) => {
  if (!s) {
    return null;
  }
  const p = s.provenance;
  const label = provLabel(p);
  return (
    <Badge
      className={cn(
        "block h-4 max-w-[88px] truncate rounded-sm px-1 font-mono text-[9px] leading-4",
        p.kind === "utility" && "bg-brand/20 text-brand",
        (p.kind === "inherited" || p.kind === "default") &&
          "text-muted-foreground"
      )}
      title={`${p.kind}${p.token ? ` · ${p.token}` : ""}${p.className ? ` · .${p.className}` : ""}`}
      variant={provVariant(p)}
    >
      {label}
    </Badge>
  );
};

const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key === "Enter") {
    (e.target as HTMLInputElement).blur();
  }
};

const arrowStep = (e: { shiftKey: boolean; altKey: boolean }) => {
  if (e.shiftKey) {
    return 10;
  }
  return e.altKey ? 1 : 4;
};

/** Number field for a CSS px value that writes a Tailwind class on commit. */
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
  const [draft, setDraft] = useState<string | null>(null);
  const util = propertyToUtility[prop];
  const commit = useCallback(() => {
    if (draft === null || !util) {
      return;
    }
    const v = draft.trim();
    setDraft(null);
    if (v === "" || v === px(s?.value)) {
      return;
    }
    const cls = classForValue(util, v);
    if (cls) {
      onClass([cls], removalFor(s));
    }
  }, [draft, util, s, onClass]);
  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
    []
  );
  const nudge = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const n = Number.parseFloat(draft ?? px(s?.value)) || 0;
      const step = arrowStep(e);
      const next = Math.max(0, n + (e.key === "ArrowUp" ? step : -step));
      const cls = util ? classForValue(util, String(next)) : null;
      if (cls) {
        onClass([cls], removalFor(s));
      }
    },
    [draft, util, s, onClass]
  );
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      blurOnEnter(e);
      if (e.key === "Escape") {
        setDraft(null);
      }
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !disabled) {
        nudge(e);
      }
    },
    [disabled, nudge]
  );
  return (
    <InputGroup
      className="h-6 min-w-0 flex-1"
      data-disabled={disabled}
      title={`${prop}: ${s?.value ?? ""}`}
    >
      {short ? (
        <InputGroupAddon className="w-5 py-0 pl-1.5 font-normal text-[10px]">
          {short}
        </InputGroupAddon>
      ) : null}
      <InputGroupInput
        className="h-full px-1.5 md:text-[11px]"
        disabled={disabled}
        onBlur={commit}
        onChange={onChange}
        onKeyDown={onKeyDown}
        value={draft ?? px(s?.value)}
      />
    </InputGroup>
  );
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
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) {
    return arbitrary(util.prefix, v);
  }
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

interface TokenOption {
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
    preview: (
      <span
        className="size-3 shrink-0 rounded-sm border border-input"
        style={{ background: value }}
      />
    ),
    value: util,
  };
};

const fontOption = (name: string, value: string): TokenOption | null => {
  if (!(name.startsWith("--font-") && !name.includes("--"))) {
    return null;
  }
  const util = name.replace(FONT_TOKEN_PREFIX_RE, "");
  if (name.slice(7).includes("--")) {
    return null;
  }
  return {
    label: `${util} · ${value.split(",")[0]?.replaceAll('"', "")}`,
    value: util,
  };
};

const useTokenOptions = (kind: "color" | "font") => {
  const tokens = useEditor((s) => s.tokens);
  return useMemo(() => {
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
  }, [tokens, kind]);
};

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
  const current = s?.provenance.className?.startsWith(`${prefix}-`)
    ? s.provenance.className.slice(prefix.length + 1)
    : null;
  const recent = useRecent("color");
  const ordered = [
    ...recent
      .filter((r) => options.find((o) => o.value === r))
      .map(
        (r) => options.find((o) => o.value === r) as (typeof options)[number]
      ),
    ...options.filter((o) => !recent.includes(o.value)),
  ];
  const onChange = useCallback(
    (v: string) => {
      if (v === "__custom") {
        promptDialog({
          defaultValue: s?.value ?? "#000000",
          description: `Any CSS colour value. It is written as an arbitrary ${prefix}-[…] class.`,
          title: "Custom colour",
        }).then((hex) => {
          if (hex) {
            onClass([arbitrary(prefix, hex)], removalFor(s));
          }
        });
        return;
      }
      recent.push(v);
      onClass([`${prefix}-${v}`], removalFor(s));
    },
    [s, prefix, onClass, recent]
  );
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <span
        className="size-5 shrink-0 rounded-sm border border-input"
        style={{ background: s?.value }}
      />
      <OptionSelect
        disabled={disabled}
        onChange={onChange}
        options={[...ordered, { label: "Custom…", value: "__custom" }]}
        placeholder={s?.value ?? "—"}
        size="sm"
        value={current}
      />
    </div>
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

const scaleValue = (cls: string | undefined, prefix: string) => {
  if (cls?.startsWith(`${prefix}-`)) {
    return cls.slice(prefix.length + 1);
  }
  return cls === prefix ? "" : null;
};

const ScaleSelect = ({
  prop,
  prefix,
  scale,
  styles,
  onClass,
  disabled,
  labels,
}: {
  prop: string;
  prefix: string;
  scale: readonly string[];
  styles: Record<string, StyleValue>;
  onClass: (add: string[], remove: string[]) => void;
  disabled: boolean;
  labels?: (v: string) => string;
}) => {
  const s = styles[prop];
  const cls = s?.provenance.className;
  const current = scaleValue(cls, prefix);
  const onChange = useCallback(
    (v: string) => {
      if (v === "__custom") {
        promptDialog({
          defaultValue: px(s?.value),
          description: "A px number or any CSS value.",
          title: `Custom ${prop}`,
        }).then((raw) => {
          const util = propertyToUtility[prop];
          if (!(raw && util)) {
            return;
          }
          const c = classForValue(util, raw);
          if (c) {
            onClass([c], removalFor(s));
          }
        });
        return;
      }
      onClass([v === "" ? prefix : `${prefix}-${v}`], removalFor(s));
    },
    [s, prop, prefix, onClass]
  );
  return (
    <OptionSelect
      disabled={disabled}
      onChange={onChange}
      options={[
        ...scale.map((v) => ({ label: labels ? labels(v) : v, value: v })),
        { label: "Custom…", value: "__custom" },
      ]}
      placeholder={px(s?.value) || "—"}
      size="sm"
      value={current}
    />
  );
};

export const Inspector = () => {
  const selection = useEditor((s) => s.selection);
  const inspect = useEditor((s) => s.inspect);
  const tree = useEditor((s) =>
    selection ? s.trees[selection.screenId] : undefined
  );
  const [source, setSource] = useState<ElementSource | null>(null);
  const requestSeq = useRef(0);

  // Load inspection + source whenever selection or tree changes (tree changes after HMR).
  useEffect(() => {
    if (!(selection && tree)) {
      useEditor.getState().setInspect(null);
      setSource(null);
      return;
    }
    requestSeq.current += 1;
    const seq = requestSeq.current;
    const bridge = bridgeFor(selection.screenId);
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
            setSource(s);
          }
        })
        .catch(() => setSource(null));
    } else {
      setSource(null);
    }
  }, [selection, tree]);

  const target = selection?.source ?? null;
  const onClass = useCallback(
    (add: string[], remove: string[]) => {
      if (!target) {
        return;
      }
      runEdit({ add, kind: "setClasses", remove, target });
    },
    [target]
  );
  const setAttr = useCallback(
    (name: string, value: JsonValue) => {
      if (!target) {
        return;
      }
      runEdit({
        kind: "setAttribute",
        name,
        target,
        value,
      });
    },
    [target]
  );

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
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <DisplaySelect
              disabled={!editable}
              onClass={onClass}
              styles={styles}
            />
            <Prov s={styles.display} />
          </div>
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
              <Prov s={styles["row-gap"]} />
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
        <div className="flex gap-1 pl-[72px]">
          <Prov s={styles.width} />
          <Prov s={styles.height} />
        </div>
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
        <div className="flex flex-wrap gap-1 pl-[72px]">
          <Prov s={styles["padding-top"]} />
          {styles["padding-left"]?.provenance.className !==
            styles["padding-top"]?.provenance.className && (
            <Prov s={styles["padding-left"]} />
          )}
        </div>
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
        <div className="flex gap-1 pl-[72px]">
          <Prov s={styles["margin-top"]} />
        </div>
      </Section>

      <Section title="Typography">
        <Row label="Family">
          <FontSelect disabled={!editable} onClass={onClass} styles={styles} />
        </Row>
        <Row label="Size">
          <ScaleSelect
            disabled={!editable}
            labels={fontSizeLabel}
            onClass={onClass}
            prefix="text"
            prop="font-size"
            scale={fontSizeScale}
            styles={styles}
          />
          <Prov s={styles["font-size"]} />
        </Row>
        <Row label="Weight">
          <ScaleSelect
            disabled={!editable}
            onClass={onClass}
            prefix="font"
            prop="font-weight"
            scale={fontWeightScale}
            styles={styles}
          />
          <Prov s={styles["font-weight"]} />
        </Row>
        <Row label="Line height">
          <ScaleSelect
            disabled={!editable}
            onClass={onClass}
            prefix="leading"
            prop="line-height"
            scale={leadingScale}
            styles={styles}
          />
          <Prov s={styles["line-height"]} />
        </Row>
        <Row label="Tracking">
          <ScaleSelect
            disabled={!editable}
            onClass={onClass}
            prefix="tracking"
            prop="letter-spacing"
            scale={trackingScale}
            styles={styles}
          />
          <Prov s={styles["letter-spacing"]} />
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
          <Prov s={styles.color} />
        </Row>
        <Row label="Background">
          <ColorField
            disabled={!editable}
            onClass={onClass}
            prefix="bg"
            prop="background-color"
            styles={styles}
          />
          <Prov s={styles["background-color"]} />
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
          <Prov s={styles["border-top-width"]} />
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
          />
          <Prov s={styles["border-top-left-radius"]} />
        </Row>
      </Section>

      <Section title="Effects">
        <Row label="Opacity">
          <OpacityField
            disabled={!editable}
            onClass={onClass}
            styles={styles}
          />
          <Prov s={styles.opacity} />
        </Row>
        <Row label="Shadow">
          <ScaleSelect
            disabled={!editable}
            onClass={onClass}
            prefix="shadow"
            prop="box-shadow"
            scale={shadowScale}
            styles={styles}
          />
          <Prov s={styles["box-shadow"]} />
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

const displayOptions = [
  "block",
  "flex",
  "inline-flex",
  "grid",
  "inline",
  "inline-block",
  "none",
  "contents",
].map((v) => ({ label: v, value: v }));

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
  const onChange = useCallback(
    (v: string) => onClass([v === "none" ? "hidden" : v], removalFor(s)),
    [s, onClass]
  );
  return (
    <OptionSelect
      disabled={disabled}
      onChange={onChange}
      options={displayOptions}
      size="sm"
      value={s?.value ?? null}
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

const fontSizeLabel = (v: string) => `${v} · ${v}`;
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
  const onChange = useCallback(
    (v: string) => onClass([classFor(v)], removalFor(s)),
    [s, classFor, onClass]
  );
  return (
    <Segmented
      disabled={disabled}
      onChange={onChange}
      options={options}
      value={s?.value ?? null}
    />
  );
};

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
  const onBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      const n = Number(e.target.value);
      if (Number.isFinite(n)) {
        onClass(
          [n >= 100 ? "opacity-100" : `opacity-${Math.round(n)}`],
          removalFor(s)
        );
      }
    },
    [s, onClass]
  );
  return (
    <InputGroup className="h-6 w-20" data-disabled={disabled}>
      <InputGroupInput
        className="h-full px-1.5 md:text-[11px]"
        defaultValue={Math.round(Number.parseFloat(s?.value ?? "1") * 100)}
        disabled={disabled}
        key={s?.value}
        onBlur={onBlur}
        onKeyDown={blurOnEnter}
      />
      <InputGroupAddon
        align="inline-end"
        className="py-0 pr-1.5 font-normal text-[10px]"
      >
        %
      </InputGroupAddon>
    </InputGroup>
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
  const options = useTokenOptions("font");
  const s = styles["font-family"];
  const cls = s?.provenance.className;
  const current =
    cls?.startsWith("font-") && options.find((o) => o.value === cls.slice(5))
      ? cls.slice(5)
      : null;
  const onChange = useCallback(
    (v: string) => onClass([`font-${v}`], removalFor(s)),
    [s, onClass]
  );
  return (
    <>
      <OptionSelect
        disabled={disabled}
        onChange={onChange}
        options={options}
        placeholder={s?.value.split(",")[0]?.replaceAll('"', "") ?? "—"}
        size="sm"
        value={current}
      />
      <Prov s={s} />
    </>
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
  const remove = useCallback(() => onClass([], [name]), [name, onClass]);
  return (
    <Badge
      className="rounded-sm bg-brand/20 px-1.5 font-mono text-brand hover:bg-destructive/20 hover:text-destructive disabled:pointer-events-none"
      onClick={remove}
      render={<button disabled={disabled} type="button" />}
      title="Remove"
    >
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
  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
    []
  );
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && draft.trim()) {
        onClass(draft.trim().split(WHITESPACE_RE), []);
        setDraft("");
      }
    },
    [draft, onClass]
  );
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
  const selectAncestor = useCallback(() => {
    const s = useEditor.getState();
    if (!(s.selection && ancestor)) {
      return;
    }
    s.select({
      nodeId: ancestor.nodeId,
      screenId: s.selection.screenId,
      source: ancestor.source,
    });
  }, [ancestor]);
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
            , not from a screen file, so its values are read-only here.
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
