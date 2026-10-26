/**
 * Whether frames are drawn from captures of their instances when they can (PLAN-editor-renderer
 * Phase 6, an experiment): `?captures=1` in the editor's address, or `"1"` under
 * `ultrapaint:captures` in this browser's storage.
 */
const KEY = "ultrapaint:captures";

let on: boolean | null = null;

export const capturesOn = (): boolean => {
  if (on === null) {
    const asked = new URLSearchParams(window.location.search).get("captures");
    if (asked !== null) {
      localStorage.setItem(KEY, asked === "1" ? "1" : "0");
    }
    on = localStorage.getItem(KEY) === "1";
  }
  return on;
};
