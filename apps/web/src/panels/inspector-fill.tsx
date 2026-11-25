/**
 * The inspector's Fill section (ADR 0134): a box's fill as its layers, the top one first, one row
 * each. A row's swatch previews its layer and opens the popover that edits it (its kind, a
 * gradient's shape, stops and angle, an image's file and fit, ADR 0149); the section lists, the
 * popover edits one layer (ADR 0102).
 * The section's + puts a colour on top, a row's − takes its layer off. Every change writes the
 * whole fill as one edit, through the fill's field, so it lands at the view's breakpoint (ADR
 * 0036) and on an instance's layer as its override (ADR 0114).
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { shortName } from "@ultrapaint/contracts/token-table";
import { PLACEHOLDER_IMAGE } from "@ultrapaint/design-document/factories";
import {
  angleOf,
  type FillLayer,
  type FillStop,
  fillCss,
  fillLayers,
  type GradientLayer,
  type GradientShape,
  type ImageFit,
  type ImageLayer,
  placedInPercent,
  positionPercent,
  resolveFillTokens,
  resolveFillUrls,
  stopPositions,
} from "@ultrapaint/design-document/fill";
import { isOffSystem } from "@ultrapaint/design-document/off-system";
import {
  isToken,
  tokenName,
  tokenValues,
} from "@ultrapaint/design-document/tokens";
import { assetUrlOf } from "@ultrapaint/preview-core/render-setup";
import { Minus, Plus, Upload, X } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { assetsAddress } from "../canvas/preview-module.ts";
import { IconButton } from "../components/icon-button.tsx";
import { Segmented } from "../components/segmented.tsx";
import {
  ArbitraryDot,
  type StyleOption,
} from "../components/style-combobox.tsx";
import { ValueField } from "../components/value-field.tsx";
import { setField } from "../lib/node-actions.ts";
import { sharedField, TOKEN_FIELDS } from "../lib/node-fields.ts";
import { MIXED } from "../lib/shared-value.ts";
import { Swatch, useTokenOptions } from "../lib/token-options.tsx";
import { uploadImage } from "../lib/upload-image.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useEditor } from "../state/editor.ts";
import { reportError } from "../state/project.ts";
import {
  NodeValueField,
  Row,
  Section,
  SectionAction,
  TextInput,
  useReveal,
} from "./inspector-fields.tsx";

const FILL = TOKEN_FIELDS.fill;

/** Writes layers as the fill of every node inspected, or takes the fill off when none is left. */
const writeFill = (layers: readonly FillLayer[]) =>
  setField(FILL, fillCss(layers));

/** A value typed or picked in a layer's field, as the layers it is: a gradient typed in a colour. */
const layersOfValue = (value: JsonValue): FillLayer[] =>
  value === null ? [] : fillLayers(String(value));

/** Whether CSS takes a fill typed, its tokens stood in for by a colour, as the canvas draws them. */
const acceptsBackground = (q: string) => {
  const css = resolveFillTokens(q, () => "red");
  return CSS.supports("background", css) || CSS.supports("color", css);
};

const SHAPE_NAMES: Record<GradientShape, string> = {
  conic: "Conic",
  linear: "Linear",
  radial: "Radial",
};

/** What a layer's row is labelled: its kind, a gradient by its shape. */
const labelOf = (layer: FillLayer) => {
  switch (layer.kind) {
    case "color":
      return "Colour";
    case "gradient":
      return SHAPE_NAMES[layer.shape];
    case "image":
      return "Image";
    default:
      return "Fill";
  }
};

/** What a layer's popover is titled. */
const titleOf = (layer: FillLayer) =>
  layer.kind === "gradient"
    ? `${SHAPE_NAMES[layer.shape]} gradient`
    : labelOf(layer);

/**
 * A fill drawn outside its frame, each token as the value the design system gives it and each
 * file from where the canvas finds it (ADR 0149).
 */
const usePreview = () => {
  const values = tokenValues(useDesignSystem((s) => s.designSystem));
  const canvas = useEditor((s) => s.canvas) ?? "";
  return (css: string) =>
    resolveFillUrls(
      resolveFillTokens(css, (name) => values.get(name) ?? "transparent"),
      (src) => assetUrlOf(assetsAddress(), canvas, src)
    );
};

/** A layer's CSS, drawn on its own: an image covering its swatch, whatever its fit. */
const layerPreviewCss = (layer: FillLayer) => {
  if (layer.kind === "css") {
    return layer.css;
  }
  return (
    fillCss([layer.kind === "image" ? { ...layer, fit: "cover" } : layer]) ?? ""
  );
};

/** A kind Kind makes a layer: any the editor reads. */
type LayerKind = Exclude<FillLayer["kind"], "css">;

/** The picture an image layer holds before a file is chosen: an image node's placeholder. */
const NEW_IMAGE: ImageLayer = {
  fit: "cover",
  kind: "image",
  src: PLACEHOLDER_IMAGE,
};

/**
 * A layer turned into another kind: a colour into a gradient from it, a gradient into its first
 * colour, either into a picture still to choose (ADR 0149); a picture into no colour.
 */
const asKind = (layer: FillLayer, kind: LayerKind): FillLayer => {
  if (kind === "image") {
    return layer.kind === "image" ? layer : NEW_IMAGE;
  }
  if (kind === "gradient") {
    if (layer.kind === "gradient") {
      return layer;
    }
    const color = layer.kind === "color" ? layer.color : "transparent";
    return {
      interpolation: "oklab",
      kind: "gradient",
      shape: "linear",
      stops: [{ color }, { color: "transparent" }],
    };
  }
  if (layer.kind === "gradient") {
    return { color: layer.stops[0]?.color ?? "transparent", kind: "color" };
  }
  return layer.kind === "image"
    ? { color: "transparent", kind: "color" }
    : layer;
};

/**
 * A gradient's stops as another shape takes them: a conic gradient's angles as their share of the
 * turn, which a linear or radial one reads; a length, which a conic one cannot, left for CSS to
 * place.
 */
const stopsFor = (layer: GradientLayer, shape: GradientShape): FillStop[] => {
  // A linear and a radial gradient take the same positions; a conic one takes angles, no lengths.
  const conic = layer.shape === "conic" || shape === "conic";
  if (!conic || placedInPercent(layer.stops, shape)) {
    return [...layer.stops];
  }
  if (placedInPercent(layer.stops, layer.shape)) {
    return placed(layer);
  }
  // Lengths, which a conic gradient cannot take, left for CSS to place; percentages kept.
  return layer.stops.map((stop) =>
    stop.position !== undefined &&
    positionPercent(stop.position, shape) !== null
      ? stop
      : { color: stop.color }
  );
};

/** A gradient of another shape, with its stops and colour space; an angle kept where both take one. */
const asShape = (
  layer: GradientLayer,
  shape: GradientShape
): GradientLayer => ({
  kind: "gradient",
  shape,
  stops: stopsFor(layer, shape),
  ...(layer.interpolation !== undefined && {
    interpolation: layer.interpolation,
  }),
  ...(shape !== "radial" &&
    layer.shape !== "radial" && { angle: angleOf(layer) }),
  ...(shape === layer.shape &&
    layer.geometry !== undefined && { geometry: layer.geometry }),
});

/**
 * A gradient's stops each in percent at the place CSS draws it, `at` overriding some, in the order
 * they then run; as they are written where one is placed in a length, which percent cannot say.
 */
const placed = (
  layer: GradientLayer,
  at: (i: number, drawn: number) => number = (_i, drawn) => drawn
): FillStop[] => {
  const { shape, stops } = layer;
  if (!placedInPercent(stops, shape)) {
    return [...stops];
  }
  const drawn = stopPositions(stops, shape);
  let before = Number.NEGATIVE_INFINITY;
  return (
    stops
      .map((stop, i) => ({ at: at(i, drawn[i] ?? 0), stop }))
      .sort((a, b) => a.at - b.at)
      // Written to a hundredth, never before the stop ahead of it.
      .map(({ at: p, stop }) => {
        before = Math.max(before, Math.round(p * 100) / 100);
        return { color: stop.color, position: `${before}%` };
      })
  );
};

/** A place on the bar as its label reads it, to a tenth: `33.3%`. */
const percentLabel = (p: number) => `${Math.round(p * 10) / 10}%`;

/** A gradient's stops with one more at `to` percent, of the colour of the stop before it. */
const withStopAt = (layer: GradientLayer, to: number): FillStop[] => {
  const drawn = stopPositions(layer.stops, layer.shape);
  const before = drawn.findLastIndex((p) => p <= to);
  const color = layer.stops[Math.max(0, before)]?.color ?? "transparent";
  const stops = placed(layer);
  const after = drawn.findIndex((p) => p > to);
  stops.splice(after < 0 ? stops.length : after, 0, {
    color,
    position: `${to}%`,
  });
  return stops;
};

/** The middle of the widest room between two stops, where a stop added without a place goes. */
const widestGap = (layer: GradientLayer): number => {
  const drawn = stopPositions(layer.stops, layer.shape);
  let at = 50;
  let widest = -1;
  for (let i = 1; i < drawn.length; i += 1) {
    const [a, b] = [drawn[i - 1] ?? 0, drawn[i] ?? 100];
    if (b - a > widest) {
      widest = b - a;
      at = Math.round((a + b) / 2);
    }
  }
  return at;
};

/** Which way an arrow key moves a stop along its bar. */
const ARROWS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };

const percentAlong = (bar: HTMLElement, clientX: number) => {
  const box = bar.getBoundingClientRect();
  const share = box.width > 0 ? (clientX - box.left) / box.width : 0;
  return Math.round(Math.min(1, Math.max(0, share)) * 100);
};

const acceptsColor = (q: string) => CSS.supports("color", q);

/**
 * A colour of the design system or typed, as the inspector offers it everywhere (ADR 0045). A
 * layer's row takes any fill typed, a gradient made a layer that way; a stop takes a colour.
 */
const ColorValue = ({
  accept = acceptsColor,
  autoOpen,
  extra = [],
  leading,
  onChange,
  title,
  value,
}: {
  accept?: (query: string) => boolean;
  autoOpen?: boolean;
  /** Options offered after the design system's colours. */
  extra?: readonly StyleOption[];
  leading?: ReactNode;
  onChange: (value: JsonValue) => void;
  title?: string;
  value: string | undefined;
}) => {
  const colors = useTokenOptions("color");
  return (
    <ValueField
      accept={accept}
      autoOpen={autoOpen}
      // A raw colour is offered its nearest token, or a new one (ADR 0136).
      colors="background"
      kind="color"
      leading={leading}
      onChange={onChange}
      options={[...colors, ...extra]}
      placeholder="None"
      title={title}
      value={value}
    />
  );
};

/** The colour a stop fades out to, which is no value off the system (ADR 0134). */
const TRANSPARENT: StyleOption = {
  description: "No colour",
  label: "transparent",
  preview: <Swatch color="transparent" />,
  value: "transparent",
};

/** A colour as a row's summary names it: a token by its short name, `primary`. */
const colorName = (color: string) =>
  isToken(color) ? shortName(tokenName(color)) : color;

/**
 * The bar a gradient's stops sit on, drawn as the gradient runs from left to right: pressed, it
 * adds a stop there; a stop dragged along it, or moved with the arrow keys, goes where it is let
 * go, as one edit. A gradient with a stop placed in a length (`10px`, `calc(…)`) is drawn and
 * left where it is written, with no stop to move: only the box could say where the others sit.
 */
const StopBar = ({
  layer,
  movable,
  onChange,
}: {
  layer: GradientLayer;
  /** Whether its stops can be placed in percent (`placedInPercent`). */
  movable: boolean;
  onChange: (stops: FillStop[]) => void;
}) => {
  const bar = useRef<HTMLDivElement>(null);
  const preview = usePreview();
  const [drag, setDrag] = useState<{ index: number; at: number } | null>(null);
  const drawn = stopPositions(layer.stops, layer.shape);
  const at = (i: number) => (drag?.index === i ? drag.at : (drawn[i] ?? 0));
  const css = fillCss([
    {
      angle: 90,
      kind: "gradient",
      shape: "linear",
      stops: movable
        ? layer.stops.map((s, i) => ({ ...s, position: `${at(i)}%` }))
        : layer.stops,
      ...(layer.interpolation !== undefined && {
        interpolation: layer.interpolation,
      }),
    },
  ]);
  const move = (index: number, to: number) =>
    onChange(placed(layer, (i, p) => (i === index ? to : p)));
  const add = (to: number) => onChange(withStopAt(layer, to));
  return (
    <div
      className={cn(
        "relative h-6 rounded-sm border border-foreground/15",
        movable && "cursor-copy"
      )}
      data-stop-bar=""
      onPointerDown={(e) => {
        if (movable && e.target === bar.current && e.button === 0) {
          add(percentAlong(e.currentTarget, e.clientX));
        }
      }}
      ref={bar}
      style={{ background: preview(css ?? "") }}
    >
      {(movable ? layer.stops : []).map((stop, i) => (
        <button
          aria-label={`Stop ${i + 1} of ${layer.stops.length}, at ${percentLabel(at(i))}`}
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2 border-background shadow-sm outline-none ring-1 ring-foreground/40 focus-visible:ring-2 focus-visible:ring-ring"
          data-stop={i}
          // biome-ignore lint/suspicious/noArrayIndexKey: a stop is its place in the gradient
          key={i}
          onKeyDown={(e) => {
            const by = (ARROWS[e.key] ?? 0) * (e.shiftKey ? 10 : 1);
            if (by !== 0) {
              e.preventDefault();
              move(i, Math.min(100, Math.max(0, at(i) + by)));
            }
          }}
          // A drag the browser cancels moves nothing.
          onPointerCancel={() => setDrag(null)}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            setDrag({ at: at(i), index: i });
          }}
          onPointerMove={(e) => {
            if (drag?.index === i && bar.current) {
              setDrag({ at: percentAlong(bar.current, e.clientX), index: i });
            }
          }}
          onPointerUp={() => {
            if (drag?.index === i) {
              setDrag(null);
              if (drag.at !== drawn[i]) {
                move(i, drag.at);
              }
            }
          }}
          style={{
            background: preview(stop.color),
            left: `${at(i)}%`,
          }}
          type="button"
        />
      ))}
    </div>
  );
};

/** A gradient's shape, stops and angle. */
const GradientFields = ({
  layer,
  onChange,
}: {
  layer: GradientLayer;
  onChange: (layer: GradientLayer) => void;
}) => {
  const stops = (next: readonly FillStop[]) =>
    onChange({ ...layer, stops: next });
  const drawn = stopPositions(layer.stops, layer.shape);
  const movable = placedInPercent(layer.stops, layer.shape);
  return (
    <>
      <Row label="Shape">
        <Segmented
          onChange={(shape) => onChange(asShape(layer, shape))}
          options={(["linear", "radial", "conic"] as const).map((value) => ({
            label: SHAPE_NAMES[value],
            value,
          }))}
          value={layer.shape}
        />
      </Row>
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <StopBar layer={layer} movable={movable} onChange={stops} />
        </div>
        <IconButton
          className="shrink-0 text-muted-foreground"
          disabled={!movable}
          onClick={() => stops(withStopAt(layer, widestGap(layer)))}
          size="icon-sm"
          tooltip="Add stop"
        >
          <Plus />
        </IconButton>
      </div>
      {movable ? null : (
        <p className="font-body-small text-muted-foreground">
          Stops placed in a length stay where they are written.
        </p>
      )}
      {layer.stops.map((stop, i) => (
        <Row
          // biome-ignore lint/suspicious/noArrayIndexKey: a stop is its place in the gradient
          key={i}
          label={
            movable ? percentLabel(drawn[i] ?? 0) : (stop.position ?? "auto")
          }
        >
          <ColorValue
            extra={[TRANSPARENT]}
            onChange={(value) =>
              value === null
                ? undefined
                : stops(
                    layer.stops.map((s, j) =>
                      j === i ? { ...s, color: String(value) } : s
                    )
                  )
            }
            title={`Stop ${i + 1}`}
            value={stop.color}
          />
          <IconButton
            className="shrink-0 text-muted-foreground"
            disabled={layer.stops.length <= 2}
            onClick={() => stops(placed(layer).filter((_, j) => j !== i))}
            size="icon-sm"
            tooltip="Remove stop"
          >
            <X />
          </IconButton>
        </Row>
      ))}
      {layer.shape === "radial" ? null : (
        <Row label="Angle">
          <ValueField
            onChange={(value) => {
              const angle = Number.parseFloat(String(value ?? 0));
              if (Number.isFinite(angle)) {
                const { side: _side, ...rest } = layer;
                onChange({ ...rest, angle });
              }
            }}
            options={[0, 45, 90, 135, 180, 225, 270, 315].map((a) => ({
              label: `${a}°`,
              value: String(a),
            }))}
            title="Angle"
            value={angleOf(layer)}
          />
        </Row>
      )}
    </>
  );
};

/** What an image's file field reads: its path, or that it is the placeholder. */
const fileName = (src: string) =>
  src.startsWith("data:") ? "placeholder" : src;

/** An image's file, uploaded into the canvas's assets or typed, and its fit (ADR 0149). */
const ImageFields = ({
  layer,
  onChange,
}: {
  layer: ImageLayer;
  onChange: (layer: ImageLayer) => void;
}) => {
  const input = useRef<HTMLInputElement>(null);
  // The layer as it is when the file arrives: a fit picked while it uploads is kept.
  const latest = useRef({ layer, onChange });
  useLayoutEffect(() => {
    latest.current = { layer, onChange };
  });
  // Which upload may still set the file: the last one started, while the layer is an image.
  const uploads = useRef(0);
  useEffect(
    () => () => {
      uploads.current += 1;
    },
    []
  );
  const upload = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    uploads.current += 1;
    const mine = uploads.current;
    try {
      const src = await uploadImage(file);
      if (uploads.current !== mine) {
        return;
      }
      latest.current.onChange({ ...latest.current.layer, src });
    } catch (error) {
      reportError(error);
    }
  };
  return (
    <>
      <Row label="File">
        <div
          className="flex min-w-0 flex-1 items-center gap-1"
          data-fill-file=""
        >
          <TextInput
            onChange={(src) =>
              src === "" ? undefined : onChange({ ...layer, src })
            }
            value={fileName(layer.src)}
          />
          <IconButton
            className="shrink-0 text-muted-foreground"
            onClick={() => input.current?.click()}
            size="icon-sm"
            tooltip="Upload an image"
          >
            <Upload />
          </IconButton>
          <input
            accept="image/*"
            className="hidden"
            onChange={(e) => upload(e.target.files?.[0])}
            ref={input}
            type="file"
          />
        </div>
      </Row>
      <Row label="Fit">
        <Segmented
          onChange={(fit: ImageFit) => onChange({ ...layer, fit })}
          options={[
            { label: "Cover", value: "cover" as const },
            { label: "Contain", value: "contain" as const },
            { label: "Fill", value: "fill" as const },
          ]}
          value={layer.fit ?? null}
        />
      </Row>
    </>
  );
};

/** The fields of one layer's kind: a gradient's, an image's, or a colour's. */
const LayerFields = ({
  layer,
  onChange,
}: {
  layer: FillLayer;
  onChange: (layer: FillLayer) => void;
}) => {
  switch (layer.kind) {
    case "gradient":
      return <GradientFields layer={layer} onChange={onChange} />;
    case "image":
      return <ImageFields layer={layer} onChange={onChange} />;
    default:
      return (
        <Row label="Colour">
          <ColorValue
            onChange={(value) => {
              const [next] = layersOfValue(value);
              if (next) {
                onChange(next);
              }
            }}
            value={layer.kind === "color" ? layer.color : layer.css}
          />
        </Row>
      );
  }
};

/** What edits one layer: its kind, then a colour, a gradient's or an image's fields. */
const LayerPopover = ({
  layer,
  onChange,
}: {
  layer: FillLayer;
  onChange: (layer: FillLayer) => void;
}) => (
  <PopoverContent align="start" className="w-72 gap-2" side="left">
    <PopoverHeader>
      <PopoverTitle>{titleOf(layer)}</PopoverTitle>
    </PopoverHeader>
    <Row label="Kind">
      <Segmented
        onChange={(kind) => onChange(asKind(layer, kind))}
        options={[
          { label: "Colour", value: "color" as const },
          { label: "Gradient", value: "gradient" as const },
          { label: "Image", value: "image" as const },
        ]}
        value={layer.kind === "css" ? "color" : layer.kind}
      />
    </Row>
    <LayerFields layer={layer} onChange={onChange} />
  </PopoverContent>
);

/** Whether a layer's popover is open, and how it is opened and closed. */
type OpenState = readonly [boolean, (open: boolean) => void];

/** A layer's swatch, a button opening its popover where the layer can be edited. */
const LayerSwatch = ({
  children,
  layer,
  onChange,
  open,
}: {
  children?: ReactNode;
  layer: FillLayer;
  onChange: (layer: FillLayer) => void;
  open: OpenState;
}) => {
  const preview = usePreview();
  return (
    <Popover onOpenChange={open[1]} open={open[0]}>
      <PopoverTrigger
        render={
          <button
            aria-label={`Edit the ${titleOf(layer).toLowerCase()} layer`}
            className={cn(
              "flex min-w-0 items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
              // A summary beside the swatch is cut to the row rather than run under its −.
              children === undefined && "shrink-0"
            )}
            data-layer-swatch=""
            type="button"
          />
        }
      >
        <Swatch color={preview(layerPreviewCss(layer))} />
        {children}
      </PopoverTrigger>
      <LayerPopover layer={layer} onChange={onChange} />
    </Popover>
  );
};

/** What a layer's row holds: a colour's field, a gradient's stops, or a fill kept as it is. */
const LayerContent = ({
  layer,
  onChange,
  onReplace,
  open,
}: {
  layer: FillLayer;
  onChange: (layer: FillLayer) => void;
  onReplace: (layers: readonly FillLayer[]) => void;
  open: OpenState;
}) => {
  const preview = usePreview();
  const colors = useTokenOptions("color");
  switch (layer.kind) {
    case "color":
      return (
        <ColorValue
          accept={acceptsBackground}
          leading={
            <LayerSwatch layer={layer} onChange={onChange} open={open} />
          }
          onChange={(value) => onReplace(layersOfValue(value))}
          title="Colour"
          value={layer.color}
        />
      );
    case "image":
      // A picture is no colour: it shows no off-system dot (ADR 0149).
      return (
        <div className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md bg-muted px-2">
          <LayerSwatch layer={layer} onChange={onChange} open={open}>
            <span className="min-w-0 truncate font-body">
              {fileName(layer.src).split("/").at(-1)}
            </span>
          </LayerSwatch>
        </div>
      );
    case "gradient":
      return (
        <div className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md bg-muted px-2">
          <LayerSwatch layer={layer} onChange={onChange} open={open}>
            <span className="min-w-0 truncate font-body">
              {layer.stops.map((s) => colorName(s.color)).join(" → ")}
            </span>
          </LayerSwatch>
          <span className="flex-1" />
          {isOffSystem("color", layerPreviewCss(layer)) ? (
            <ArbitraryDot />
          ) : null}
        </div>
      );
    default:
      // A fill the editor cannot read stays as it is, to be replaced whole.
      return (
        <ValueField
          accept={acceptsBackground}
          leading={<Swatch color={preview(layer.css)} />}
          onChange={(value) => setField(FILL, value)}
          options={colors}
          title="Fill"
          value={layer.css}
        />
      );
  }
};

/** One layer's row: its swatch and what it holds, and the − that takes it off. */
const LayerRow = ({
  index,
  layers,
}: {
  index: number;
  layers: readonly FillLayer[];
}) => {
  // The row's, so that its popover stays open while Kind makes the layer another kind.
  const open = useState(false);
  const layer = layers[index];
  if (!layer) {
    return null;
  }
  const replace = (next: readonly FillLayer[]) =>
    writeFill([...layers.slice(0, index), ...next, ...layers.slice(index + 1)]);
  const edit = (next: FillLayer) => replace([next]);
  return (
    <Row fields={index === 0 ? ["fill"] : undefined} label={labelOf(layer)}>
      <div
        className="flex min-w-0 flex-1 items-center gap-1"
        data-fill-layer={layer.kind}
      >
        <LayerContent
          layer={layer}
          onChange={edit}
          onReplace={replace}
          open={open}
        />
        <SectionAction onClick={() => replace([])} tooltip="Remove fill layer">
          <Minus />
        </SectionAction>
      </div>
    </Row>
  );
};

/**
 * The fill: its layers, the top one first, and a + that puts a colour on top, its colours open to
 * pick it. Nodes whose fills differ show one field reading Mixed, which gives them all one fill.
 */
export const FillSection = ({ nodes }: { nodes: readonly DesignNode[] }) => {
  const [adding, add] = useReveal();
  const shared = sharedField(FILL, nodes);
  const layers = typeof shared === "string" ? fillLayers(shared) : [];
  const action =
    shared === MIXED ? (
      <SectionAction onClick={() => setField(FILL, null)} tooltip="Remove fill">
        <Minus />
      </SectionAction>
    ) : (
      <SectionAction onClick={() => add(true)} tooltip="Add fill layer">
        <Plus />
      </SectionAction>
    );
  return (
    <Section action={action} title="Fill">
      {shared === MIXED ? (
        <Row fields={["fill"]} label="Fill">
          <NodeValueField
            accept={acceptsBackground}
            field={FILL}
            nodes={nodes}
            placeholder="None"
          />
        </Row>
      ) : (
        <>
          {adding ? (
            <Row
              fields={layers.length === 0 ? ["fill"] : undefined}
              label="Colour"
            >
              <div
                className="flex min-w-0 flex-1 items-center gap-1"
                data-fill-layer="new"
              >
                <ColorValue
                  accept={acceptsBackground}
                  autoOpen
                  onChange={(value) => {
                    add(false);
                    if (value !== null) {
                      writeFill([...layersOfValue(value), ...layers]);
                    }
                  }}
                  title="Colour"
                  value={undefined}
                />
                <SectionAction
                  onClick={() => add(false)}
                  tooltip="Remove fill layer"
                >
                  <Minus />
                </SectionAction>
              </div>
            </Row>
          ) : null}
          {layers.map((_layer, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a layer is its place in the stack
            <LayerRow index={i} key={i} layers={layers} />
          ))}
        </>
      )}
    </Section>
  );
};
