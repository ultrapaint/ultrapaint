/**
 * The element toolbar's selects: a component's props with a picture of each value, a text's style
 * and alignment, and a token for a colour, a radius, a spacing or a shadow. Each shows its value
 * alone; the menu it opens says what it sets.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { TextStyle } from "@ultrapaint/contracts/design-system";
import type {
  DesignNode,
  InstanceNode,
  TextAlign,
  TextNode,
} from "@ultrapaint/contracts/document";
import { spacingBasePx } from "@ultrapaint/contracts/token-table";
import { groupTextStyles } from "@ultrapaint/design-document/text-styles";
import {
  ALargeSmall,
  BetweenHorizontalStart,
  ChevronDown,
  Copy,
  type LucideIcon,
  Palette,
  SlidersHorizontal,
  SquareDashed,
  SquareRoundCorner,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
} from "lucide-react";
import { type ReactNode, useContext, useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type Control,
  propValue,
  tokenLabel,
} from "../lib/element-controls.ts";
import { LruMap } from "../lib/lru.ts";
import { setField, setPropsOfNodes } from "../lib/node-actions.ts";
import {
  ALIGN,
  sharedField,
  TEXT_STYLE,
  TOKEN_FIELDS,
  type TokenFieldName,
} from "../lib/node-fields.ts";
import {
  labelOf,
  MIXED,
  MIXED_LABEL,
  sharedValue,
} from "../lib/shared-value.ts";
import { TOOLBAR_SPACING } from "../lib/spacing.ts";
import { colorGroups, tokenOptions } from "../lib/token-options.tsx";
import { ComponentProps } from "../panels/component-props.tsx";
import { useCatalogue } from "../state/catalogue.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useEditor } from "../state/editor.ts";
import { drawSpecimen, pictureKey } from "./specimens.ts";
import { Targets, useTargetNodes } from "./toolbar-targets.ts";

const NO_STYLES: readonly TextStyle[] = [];

const FIELD: Record<
  TokenFieldName,
  { icon: LucideIcon; name: string; utility: string }
> = {
  color: { icon: ALargeSmall, name: "color", utility: "text" },
  fill: { icon: SquareDashed, name: "fill", utility: "bg" },
  gap: { icon: BetweenHorizontalStart, name: "gap", utility: "gap" },
  radius: { icon: SquareRoundCorner, name: "radius", utility: "rounded" },
  shadow: { icon: Copy, name: "shadow", utility: "shadow" },
  tint: { icon: Palette, name: "tint", utility: "bg" },
};

/** The trigger of every select: an icon or a swatch, the value, a chevron. */
export const ValueTrigger = ({
  children,
  icon: Icon,
  swatch,
  tooltip,
}: {
  children: ReactNode;
  icon?: LucideIcon;
  swatch?: string | undefined;
  tooltip: string;
}) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <DropdownMenuTrigger
          render={
            <button
              className="flex h-7 max-w-40 items-center gap-1.5 rounded-md px-2 font-body outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 data-popup-open:bg-muted"
              type="button"
            />
          }
        />
      }
    >
      {Icon ? (
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      ) : null}
      {swatch === undefined ? null : (
        <span
          className="size-3 shrink-0 rounded-full border border-foreground/20"
          style={{ background: swatch }}
        />
      )}
      <span className="truncate font-medium">{children}</span>
      <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
    </TooltipTrigger>
    <TooltipContent>{tooltip}</TooltipContent>
  </Tooltip>
);

export const MenuHead = ({
  name,
  source,
}: {
  name: string;
  source?: string;
}) => (
  <DropdownMenuLabel className="flex items-center gap-2">
    <span className="flex-1">{name}</span>
    {source ? (
      <span className="font-code font-normal text-muted-foreground/70">
        {source}
      </span>
    ) : null}
  </DropdownMenuLabel>
);

/**
 * Pictures of an instance drawn in each value of one of its props, kept for the session: the
 * last few hundred, as each is a PNG held in memory.
 */
const previewCache = new LruMap<string, string | null>(200);

/**
 * The pictures of an instance in each value of one of its props, drawn while its menu is open.
 * They are held in state as well as in the cache: what a render reads has to be what changes, or
 * the compiler keeps the first answer.
 */
const useVariantPreviews = (
  node: InstanceNode,
  name: string,
  options: readonly string[],
  open: boolean
) => {
  const ds = useDesignSystem((s) => s.designSystem);
  const canvas = useEditor((s) => s.canvas) ?? "";
  const builtAt = useCatalogue((s) => s.catalogue?.builtAt ?? 0);
  const [pictures, setPictures] = useState<Record<string, string | null>>({});
  const optionsKey = options.join("|");
  useEffect(() => {
    if (!open) {
      return;
    }
    let live = true;
    // The same instance looks different in another design system, code or canvas.
    const keyOf = (option: string) =>
      pictureKey(
        [node.component, node.from, node.props, node.text, name, option],
        { builtAt, canvas, designSystem: ds }
      );
    (async () => {
      for (const option of optionsKey.split("|")) {
        // The menu closed: what it did not show yet is not drawn.
        if (!live) {
          return;
        }
        const key = keyOf(option);
        if (!previewCache.has(key)) {
          const root: InstanceNode = {
            ...node,
            props: { ...node.props, [name]: option },
          };
          // Cropped to the instance: what wraps it may take the whole preview. One at a time,
          // as the frame that draws them draws one thing.
          // biome-ignore lint/performance/noAwaitInLoops: the pictures are drawn one after the other.
          const picture = await drawSpecimen(root, ds, {
            canvas,
            nodeId: root.id,
          });
          previewCache.set(key, picture);
        }
        if (live) {
          const picture = previewCache.get(key) ?? null;
          setPictures((p) => ({ ...p, [option]: picture }));
        }
      }
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open, ds, canvas, builtAt, optionsKey, node, name]);
  return (option: string) => pictures[option] ?? null;
};

export const PropSelect = ({
  control,
  node,
  source,
}: {
  control: Extract<Control, { kind: "prop" }>;
  node: InstanceNode;
  source: string;
}) => {
  const targets = useContext(Targets);
  const [open, setOpen] = useState(false);
  const nodes = useTargetNodes();
  const value = labelOf(
    sharedValue(
      nodes.map((n) =>
        n.type === "instance"
          ? propValue(n.props, control.name, control.options)
          : ""
      )
    ),
    propValue(node.props, control.name, control.options)
  );
  const previewOf = useVariantPreviews(
    node,
    control.name,
    control.options,
    open
  );
  const onValue = (v: unknown) =>
    setPropsOfNodes(targets, { [control.name]: String(v) });
  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <ValueTrigger tooltip={control.name}>{value}</ValueTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuGroup>
          <MenuHead name={control.name} source={source} />
          <DropdownMenuRadioGroup onValueChange={onValue} value={value}>
            {control.options.map((option) => {
              const picture = previewOf(option);
              return (
                <DropdownMenuRadioItem key={option} value={option}>
                  <span className="flex h-8 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-white">
                    {picture ? (
                      <img
                        alt=""
                        className="max-h-full max-w-full object-contain"
                        height={32}
                        src={picture}
                        width={80}
                      />
                    ) : null}
                  </span>
                  {option}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const TextStyleSelect = ({ node }: { node: TextNode }) => {
  const targets = useContext(Targets);
  const styles =
    useDesignSystem((s) => s.designSystem?.typography.styles) ?? NO_STYLES;
  const style = styles.find((s) => s.name === node.textStyle);
  const mixedStyles = sharedField(TEXT_STYLE, useTargetNodes()) === MIXED;
  const onValue = (v: unknown) => {
    const next = styles.find((s) => s.name === v);
    if (next) {
      setField(TEXT_STYLE, next, targets);
    }
  };
  return (
    <DropdownMenu>
      <ValueTrigger icon={ALargeSmall} tooltip="Text style">
        {mixedStyles
          ? MIXED_LABEL
          : (style?.name ?? node.textStyle ?? "No style")}
      </ValueTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuGroup>
          <MenuHead name="Text style" source="text styles" />
          {styles.length === 0 ? (
            <DropdownMenuLabel className="font-normal">
              The design system has no text styles yet.
            </DropdownMenuLabel>
          ) : null}
          <DropdownMenuRadioGroup
            onValueChange={onValue}
            value={node.textStyle ?? ""}
          >
            {[...groupTextStyles(styles)].map(([group, list]) => (
              <DropdownMenuGroup key={group}>
                {list.map((s) => (
                  <DropdownMenuRadioItem key={s.name} value={s.name}>
                    <span
                      className="truncate"
                      style={{
                        fontSize:
                          typeof s.size === "number"
                            ? Math.min(s.size, 22)
                            : undefined,
                        fontWeight:
                          typeof s.weight === "number" ? s.weight : undefined,
                      }}
                    >
                      {s.name}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuGroup>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const ALIGNS: readonly [TextAlign, LucideIcon, string][] = [
  ["start", TextAlignStart, "Left"],
  ["center", TextAlignCenter, "Centre"],
  ["end", TextAlignEnd, "Right"],
];

export const AlignSelect = ({ node }: { node: TextNode }) => {
  const targets = useContext(Targets);
  const value = labelOf(
    sharedField(ALIGN, useTargetNodes()),
    ALIGN.read(node) ?? "start"
  );
  const found = ALIGNS.find(([v]) => v === value);
  const icon = found?.[1] ?? TextAlignStart;
  const label = found?.[2] ?? MIXED_LABEL;
  return (
    <DropdownMenu>
      <ValueTrigger icon={icon} tooltip="Alignment">
        {label}
      </ValueTrigger>
      <DropdownMenuContent className="w-40">
        <DropdownMenuGroup>
          <MenuHead name="align" />
          <DropdownMenuRadioGroup
            onValueChange={(v) => {
              const align = ALIGNS.find(([a]) => a === v)?.[0];
              if (align) {
                setField(ALIGN, align, targets);
              }
            }}
            value={value}
          >
            {ALIGNS.map(([v, Icon, l]) => (
              <DropdownMenuRadioItem key={v} value={v}>
                <Icon />
                {l}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const TokenSelect = ({
  control,
  node,
}: {
  control: Extract<Control, { kind: "token" }>;
  node: DesignNode;
}) => {
  const targets = useContext(Targets);
  const ds = useDesignSystem((s) => s.designSystem);
  const base = spacingBasePx(ds?.spacing.base);
  const field = FIELD[control.field];
  const def = TOKEN_FIELDS[control.field];
  const raw = def.read(node);
  const shared = sharedField(def, useTargetNodes());
  const label =
    shared === MIXED ? MIXED_LABEL : tokenLabel(control.field, shared, base);
  const set = (value: JsonValue) => setField(def, value, targets);
  const colors = def.options === "color" ? colorGroups(ds) : [];
  const swatch =
    def.options === "color"
      ? (colors.flatMap((g) => g.options).find((t) => t.value === raw)
          ?.swatch ?? (typeof raw === "string" ? raw : "transparent"))
      : undefined;
  const current = raw === undefined || raw === null ? "" : String(raw);

  let items: ReactNode;
  if (def.options === "color") {
    items = colors.map((group) => (
      <DropdownMenuGroup key={group.name}>
        <DropdownMenuLabel className="font-body font-normal">
          {group.name}
        </DropdownMenuLabel>
        {group.options.map((t) => (
          <DropdownMenuRadioItem key={t.value} value={t.value}>
            <span
              className="size-3.5 shrink-0 rounded-full border border-foreground/20"
              style={{ background: t.swatch }}
            />
            <span className="flex-1 truncate">{t.label}</span>
            <span className="font-code text-muted-foreground">
              {field.utility}-{t.label}
            </span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuGroup>
    ));
  } else if (def.options === "spacing") {
    items = TOOLBAR_SPACING.map((step) => (
      <DropdownMenuRadioItem key={step} value={String(step * base)}>
        <span
          className="h-2.5 shrink-0 rounded-sm bg-muted-foreground/40"
          style={{ width: Math.max(2, step * 3) }}
        />
        <span className="flex-1 font-mono">
          {field.utility}-{step}
        </span>
        <span className="font-body text-muted-foreground">{step * base}px</span>
      </DropdownMenuRadioItem>
    ));
  } else {
    items = tokenOptions(ds, def.options).map((t) => (
      <DropdownMenuRadioItem key={t.value} value={t.value}>
        <span className="flex-1 font-mono">
          {field.utility}-{t.label}
        </span>
        <span className="max-w-24 truncate font-body text-muted-foreground">
          {t.description}
        </span>
      </DropdownMenuRadioItem>
    ));
  }

  return (
    <DropdownMenu>
      <ValueTrigger
        icon={def.options === "color" ? undefined : field.icon}
        swatch={swatch}
        tooltip={field.name}
      >
        {label}
      </ValueTrigger>
      <DropdownMenuContent className="max-h-80 w-60">
        <DropdownMenuGroup>
          <MenuHead
            name={field.name}
            source={def.options === "color" ? "--color-*" : `--${def.options}`}
          />
          <DropdownMenuRadioGroup
            onValueChange={(v) => {
              const text = String(v);
              if (text === "") {
                set(null);
              } else {
                set(def.options === "spacing" ? Number(text) : text);
              }
            }}
            value={current}
          >
            <DropdownMenuRadioItem value="">
              <span className="flex-1 text-muted-foreground">none</span>
            </DropdownMenuRadioItem>
            {items}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** The props the toolbar leaves out, all of them, as the inspector shows them. */
export const MoreProps = ({
  count,
  node,
}: {
  count: number;
  node: InstanceNode;
}) => {
  const targets = useContext(Targets);
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  className="flex h-7 items-center gap-1 rounded-md bg-muted px-2 font-body font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                  type="button"
                />
              }
            />
          }
        >
          <SlidersHorizontal className="size-3.5" />+{count}
        </TooltipTrigger>
        <TooltipContent>Every prop</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-72 gap-0 p-0">
        <ComponentProps
          node={node}
          onSet={(name, value) => setPropsOfNodes(targets, { [name]: value })}
        />
      </PopoverContent>
    </Popover>
  );
};
