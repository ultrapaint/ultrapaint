/**
 * The viewports a page is drawn at, as the frame's header, the inspector and the page's context
 * menu all offer them, and the devices the prototype can be tried on.
 */
import { presetSize, type ViewportPreset } from "@ultrapaint/contracts/pages";

interface PresetOption {
  label: string;
  value: ViewportPreset;
}

interface Size {
  height: number;
  width: number;
}

/** One list for every place a frame's viewport is picked. Custom keeps the size the frame has. */
export const viewportPresets: readonly PresetOption[] = [
  { label: "Mobile", value: "mobile" },
  { label: "Tablet", value: "tablet" },
  { label: "Desktop", value: "desktop" },
  { label: "Custom", value: "custom" },
];

/** The preset a frame shows as chosen: a frame with none of its own was sized by hand. */
export const presetOf = (
  frame: { readonly preset?: ViewportPreset | undefined } | undefined
): ViewportPreset => frame?.preset ?? "custom";

/** The size a frame takes for a preset: the device's own, or for Custom the one it already has. */
export const sizeForPreset = (preset: ViewportPreset, current: Size): Size =>
  preset === "custom"
    ? { height: current.height, width: current.width }
    : presetSize[preset];

/**
 * What the prototype is shown on: one of the devices, which sizes the preview alone and never the
 * design. A page taller than the device scrolls in it.
 */
export type PrototypeDevice = Exclude<ViewportPreset, "custom">;

export const prototypeDevices: readonly {
  description: string;
  label: string;
  value: PrototypeDevice;
}[] = viewportPresets.flatMap((p) =>
  p.value === "custom"
    ? []
    : [
        {
          description: `${presetSize[p.value].width} × ${presetSize[p.value].height}`,
          label: p.label,
          value: p.value,
        },
      ]
);

/** A device read back from storage, or the desktop for anything it does not know. */
export const parseDevice = (raw: string | null): PrototypeDevice =>
  prototypeDevices.find((d) => d.value === raw)?.value ?? "desktop";
