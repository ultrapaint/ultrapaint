/**
 * The bar of a selected page, docked above the tools as an element's is (ADR 0058): the viewports
 * it can be drawn at, the views it is drawn in beside its frame (ADR 0036), then the page's menu.
 * The frame's header keeps its name and size; the inspector keeps its Viewport field.
 */
import { presetSize, type ViewportPreset } from "@ultrapaint/contracts/pages";
import {
  Columns2,
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
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { presetOf, viewportPresets } from "../lib/presets.ts";
import { useBreakpoints } from "../state/design-system.ts";
import { useEditor } from "../state/editor.ts";
import { addView, setPreset } from "../state/page-layout.ts";
import { selectPage } from "../state/selection.ts";
import { useDrag } from "./drag.ts";
import { MoreButton } from "./element-toolbar.tsx";
import { MenuHead, ValueTrigger } from "./element-toolbar-selects.tsx";
import { Divider, SelectionDock } from "./selection-dock.tsx";

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
          onValueChange={(v) => setPreset(pageId, v as ViewportPreset)}
          value={preset}
        >
          {DEVICES.map((d) => {
            const Icon = PRESET_ICON[d.value];
            return (
              <DropdownMenuRadioItem key={d.value} value={d.value}>
                <Icon />
                <span className="flex-1">{d.label}</span>
                <span className="font-body-small text-muted-foreground tabular-nums">
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

/**
 * Adds a view of the page beside its frame: at a device's width, or where a breakpoint of the
 * design system starts. The view is selected, so what is edited next lands at its breakpoint.
 */
const ViewsMenu = ({ pageId }: { pageId: string }) => {
  const count = useEditor((s) => s.frames[pageId]?.views?.length ?? 0);
  const breakpoints = useBreakpoints();
  const add = (width: number, height?: number) => {
    const view = addView(pageId, width, height);
    if (view) {
      selectPage(view);
    }
  };
  return (
    <DropdownMenu>
      <ValueTrigger icon={Columns2} tooltip="Views">
        {count === 0 ? "Views" : `${count + 1} views`}
      </ValueTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuGroup>
          <MenuHead name="Add a view" />
          {DEVICES.map((d) => {
            const Icon = PRESET_ICON[d.value];
            return (
              <DropdownMenuItem
                key={d.value}
                onClick={() => add(d.size.width, d.size.height)}
              >
                <Icon />
                <span className="flex-1">{d.label}</span>
                <span className="font-body-small text-muted-foreground tabular-nums">
                  {d.size.width}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <MenuHead name="At a breakpoint" />
          {breakpoints.map((b) => (
            <DropdownMenuItem key={b.name} onClick={() => add(b.min)}>
              <span className="flex-1 font-code">{b.name}</span>
              <span className="font-body-small text-muted-foreground tabular-nums">
                {b.min}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** In the bar above the tools while the page is selected. */
export const PageToolbar = ({ pageId }: { pageId: string }) => {
  const preset = useEditor((s) => presetOf(s.frames[pageId]));
  const dragging = useDrag((s) => s.dragged !== null);
  if (dragging) {
    return null;
  }
  return (
    <SelectionDock label="Toolbar of the page">
      <ViewportSelect pageId={pageId} preset={preset} />
      <ViewsMenu pageId={pageId} />
      <Divider />
      <MoreButton menu={{ kind: "page", pageId }} />
    </SelectionDock>
  );
};
