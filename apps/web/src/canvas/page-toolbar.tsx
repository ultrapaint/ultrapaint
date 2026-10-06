/**
 * The Vibe toolbar over a selected page: the viewports it can be drawn at, then the page's menu.
 * The frame's header keeps only its name and size; Design keeps the inspector's Viewport field.
 */
import { presetSize, type ViewportPreset } from "@ultrapaint/contracts/pages";
import {
  type LucideIcon,
  Monitor,
  Scaling,
  Smartphone,
  Tablet,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { presetOf, viewportPresets } from "../lib/presets.ts";
import { useEditor } from "../state/editor.ts";
import { useDrag } from "./drag.ts";
import { Divider, MoreButton } from "./element-toolbar.tsx";
import { MenuHead, ValueTrigger } from "./element-toolbar-selects.tsx";

const PRESET_ICON: Record<ViewportPreset, LucideIcon> = {
  custom: Scaling,
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
};

/** The devices a page can be drawn at; Custom is what a frame sized by hand already is. */
const DEVICES = viewportPresets.flatMap((p) =>
  p.value === "custom" ? [] : [{ ...p, size: presetSize[p.value] }]
);

const ViewportSelect = ({
  pageId,
  preset,
}: {
  pageId: string;
  preset: ViewportPreset;
}) => (
  <DropdownMenu>
    <ValueTrigger icon={PRESET_ICON[preset]} tooltip="Viewport">
      {viewportPresets.find((p) => p.value === preset)?.label ?? "Custom"}
    </ValueTrigger>
    <DropdownMenuContent className="w-52">
      <DropdownMenuGroup>
        <MenuHead name="viewport" />
        <DropdownMenuRadioGroup
          onValueChange={(v) =>
            useEditor.getState().setPreset(pageId, v as ViewportPreset)
          }
          value={preset}
        >
          {DEVICES.map((d) => {
            const Icon = PRESET_ICON[d.value];
            return (
              <DropdownMenuRadioItem key={d.value} value={d.value}>
                <Icon />
                <span className="flex-1">{d.label}</span>
                <span className="font-body text-muted-foreground">
                  {d.size.width} × {d.size.height}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);

/** Centred over the frame, above its header, at the same size on screen whatever the zoom. */
export const PageToolbar = ({
  headerHeight,
  inv,
  pageId,
}: {
  /** The room the frame's header takes above it, on screen, which the toolbar sits over. */
  headerHeight: number;
  inv: number;
  pageId: string;
}) => {
  const preset = useEditor((s) => presetOf(s.frames[pageId]));
  const dragging = useDrag((s) => s.dragged !== null);
  if (dragging) {
    return null;
  }
  return (
    <div
      aria-label="Toolbar of the page"
      className="absolute left-1/2 flex items-center gap-0.5 whitespace-nowrap rounded-[10px] border bg-popover p-0.5 text-popover-foreground shadow-lg"
      data-element-toolbar
      onPointerDown={(e) => e.stopPropagation()}
      role="toolbar"
      style={{
        bottom: `calc(100% + ${(headerHeight + 8) * inv}px)`,
        transform: `scale(${inv}) translateX(-50%)`,
        transformOrigin: "bottom left",
      }}
    >
      <ViewportSelect pageId={pageId} preset={preset} />
      <Divider />
      <MoreButton menu={{ kind: "page", pageId }} />
    </div>
  );
};
