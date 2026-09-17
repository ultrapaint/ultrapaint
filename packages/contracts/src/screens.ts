import { Schema } from "effect";
import { RepoRelativePath } from "./base.ts";

/** A screen is a TSX file inside the designs directory. `id` is its path relative to designsDir. */
export const Screen = Schema.Struct({
  file: RepoRelativePath,
  flow: Schema.String,
  id: Schema.String,
  name: Schema.String,
});
export type Screen = typeof Screen.Type;

export const ScreenList = Schema.Struct({ screens: Schema.Array(Screen) });
export type ScreenList = typeof ScreenList.Type;

export const ViewportPreset = Schema.Literals([
  "mobile",
  "tablet",
  "desktop",
  "custom",
]);
export type ViewportPreset = typeof ViewportPreset.Type;

export const presetSize: Record<
  Exclude<ViewportPreset, "custom">,
  { width: number; height: number }
> = {
  desktop: { height: 900, width: 1440 },
  mobile: { height: 844, width: 390 },
  tablet: { height: 1194, width: 834 },
};

export const FrameLayout = Schema.Struct({
  height: Schema.Number,
  preset: ViewportPreset,
  width: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
});
export type FrameLayout = typeof FrameLayout.Type;

/** Contents of `<flow>/canvas.json`. Keys are screen file names inside the flow directory. */
export const CanvasLayout = Schema.Struct({
  frames: Schema.Record(Schema.String, FrameLayout),
  version: Schema.Literal(1),
});
export type CanvasLayout = typeof CanvasLayout.Type;

export const emptyCanvasLayout = (): CanvasLayout => ({
  frames: {},
  version: 1,
});
