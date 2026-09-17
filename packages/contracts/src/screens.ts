import { Schema as S } from "effect";
import { RepoRelativePath } from "./base.ts";

/** A screen is a TSX file inside the designs directory. `id` is its path relative to designsDir. */
export const Screen = S.Struct({
  file: RepoRelativePath,
  flow: S.String,
  id: S.String,
  name: S.String,
});
export type Screen = typeof Screen.Type;

export const ScreenList = S.Struct({ screens: S.Array(Screen) });
export type ScreenList = typeof ScreenList.Type;

export const ViewportPreset = S.Literal(
  "mobile",
  "tablet",
  "desktop",
  "custom"
);
export type ViewportPreset = typeof ViewportPreset.Type;

export const presetSize: Record<
  Exclude<ViewportPreset, "custom">,
  { width: number; height: number }
> = {
  desktop: { height: 900, width: 1440 },
  mobile: { height: 844, width: 390 },
  tablet: { height: 1194, width: 834 },
};

export const FrameLayout = S.Struct({
  height: S.Number,
  preset: ViewportPreset,
  width: S.Number,
  x: S.Number,
  y: S.Number,
});
export type FrameLayout = typeof FrameLayout.Type;

/** Contents of `<flow>/canvas.json`. Keys are screen file names inside the flow directory. */
export const CanvasLayout = S.Struct({
  frames: S.Record({ key: S.String, value: FrameLayout }),
  version: S.Literal(1),
});
export type CanvasLayout = typeof CanvasLayout.Type;

export const emptyCanvasLayout = (): CanvasLayout => ({
  frames: {},
  version: 1,
});
