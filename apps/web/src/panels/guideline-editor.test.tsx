// @vitest-environment happy-dom
import "../testing/fake-browser.ts";
import { RequestError } from "@ultrapaint/client-runtime/connection";
import type { DesignDocument } from "@ultrapaint/contracts/design-system";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guidelineId } from "../boards/system-boards.ts";
import { useBoard } from "../state/board.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useProject } from "../state/project.ts";
import { fakeApi } from "../testing/fake-api.ts";
import { until } from "../testing/until.ts";
import { GuidelineEditor } from "./guideline-editor.tsx";

vi.mock(
  "../state/connection.ts",
  async () => (await import("../testing/fake-api.ts")).connectionModule
);

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SAVED = "Terse and plain.";
const TYPED = "Terse and plain: the noun and the number.";

const designMd: DesignDocument = {
  body: "",
  findings: [],
  held: [],
  legacy: false,
  path: "DESIGN.md",
  sections: [{ heading: "Content", section: null, text: SAVED }],
  text: "",
};
const ITEM = guidelineId("Content");

const initialBoard = useBoard.getState();
const initialDesignSystem = useDesignSystem.getState();

let mounted: Root;
let container: HTMLElement;

const field = () => container.querySelector("textarea") as HTMLTextAreaElement;

/** Types into the field as React hears it. */
const type = (value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set?.call(field(), value);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });

const leave = () =>
  act(() => {
    field().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });

beforeEach(() => {
  fakeApi.reset();
  useProject.setState({ error: null });
  useBoard.setState(initialBoard, true);
  container = document.createElement("div");
  mounted = createRoot(container);
  act(() =>
    mounted.render(<GuidelineEditor document={designMd} item={ITEM} />)
  );
});

afterEach(() => {
  act(() => mounted.unmount());
  useProject.setState({ error: null });
  useDesignSystem.setState(initialDesignSystem, true);
});

describe("a guideline's text that could not be saved", () => {
  beforeEach(() => {
    fakeApi.respond("designSystem.setSection", () =>
      Promise.reject(new RequestError("internal", "DESIGN.md is read-only"))
    );
  });

  /** Types, leaves the field, and waits for the refusal to be said. */
  const typeAndFail = async () => {
    type(TYPED);
    leave();
    await act(() => until(useProject, (s) => s.error !== null));
  };

  it("stays in the field, and on the board", async () => {
    await typeAndFail();
    expect(useProject.getState().error).toBe("DESIGN.md is read-only");
    expect(field().value).toBe(TYPED);
    expect(useBoard.getState().guideDraft).toEqual({ item: ITEM, text: TYPED });
  });

  it("is sent again when the field is left again", async () => {
    await typeAndFail();
    leave();
    await act(() => fakeApi.requested("designSystem.setSection", 2));
    expect(fakeApi.calls.at(-1)?.input).toEqual({
      name: "Content",
      text: TYPED,
    });
  });
});

describe("a guideline's text saved", () => {
  it("gives the field back to DESIGN.md's text", async () => {
    fakeApi.respond("designSystem.setSection", () => undefined as never);
    fakeApi.respond("designSystem.get", () => ({
      designSystem: null,
      document: designMd,
    }));
    type(TYPED);
    leave();
    await act(() => until(useBoard, (s) => s.guideDraft === null));
    // The document it is given still has the old text: what is typed is no longer held over it.
    expect(field().value).toBe(SAVED);
  });
});
