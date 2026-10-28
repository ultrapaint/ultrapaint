/**
 * The names of what the generated editor entry and the editor bundle export, for the framework
 * that writes the one and builds the other in Node: their shapes are `EditorEntry` and
 * `EditorBundle` in `browser.ts`, which `editor-exports.test.ts` holds these lists to.
 */

/** What the generated entry exports (`EditorEntry`). */
export const EDITOR_ENTRY_EXPORTS = ["onReloadRequest", "preview"] as const;

/** What the editor bundle exports (`EditorBundle`). */
export const EDITOR_BUNDLE_EXPORTS = ["startPreview"] as const;
