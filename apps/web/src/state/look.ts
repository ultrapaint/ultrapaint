/**
 * The design's look (ADRs 0028, 0041, 0042): every token's value in every theme, and the
 * project's components. Its stylesheet is made once per change of the design system or the
 * components and set on the preview (`followLook`), which writes it for every frame; a frame that
 * draws another look (a component's unsaved one) is given its own with its render.
 *
 * A look is edited live (ADR 0045, B9): while a field of a system component's part is typed in or
 * its options are gone through, the style it would set is laid over the component's file as the
 * server last sent it (`draftStyle`), so every frame, a page's and a board's, draws it; committed
 * (`commitStyle`), it is one `setStyle`, one undo step, and the draft gives way to the components
 * the server sends back.
 */
import type {
  ComponentFile,
  LookPlace,
  PartStyle,
} from "@ultrapaint/contracts/components";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import { withStyle } from "@ultrapaint/design-document/look-places";
import type { Look, Preview } from "@ultrapaint/preview-core/preview";
import { designCss } from "@ultrapaint/system-components/look";
import { useMemo } from "react";
import { create } from "zustand";
import { useComponents } from "./components.ts";
import { api } from "./connection.ts";
import { useDesignSystem } from "./design-system.ts";
import { reportError } from "./project.ts";

/** One part's style at one place of a system component's look, as it is being typed. */
export interface StyleDraft {
  readonly component: string;
  readonly place: LookPlace;
  readonly slot: string;
  readonly style: PartStyle;
}

/** The style being typed; null while none is. */
export const useLookDraft = create<{ draft: StyleDraft | null }>(() => ({
  draft: null,
}));

/** A draft committed: the next components the server sends replace it. */
let settling = false;

/** The components with the draft laid over its component's file. */
const drafted = (
  components: readonly ComponentFile[],
  draft: StyleDraft | null
): readonly ComponentFile[] =>
  draft
    ? components.map((c) =>
        c.name === draft.component && c.origin === "system"
          ? withStyle(c, draft.place, draft.slot, draft.style)
          : c
      )
    : components;

/** The look of the last components, draft and design system asked for, kept while they are the same. */
let memo: {
  readonly components: readonly ComponentFile[];
  readonly draft: StyleDraft | null;
  readonly ds: DesignSystem | null;
  readonly look: Look;
} | null = null;

/** The look of these components in this design system: the same object for the same three. */
const lookOf = (
  components: readonly ComponentFile[],
  draft: StyleDraft | null,
  ds: DesignSystem | null
): Look => {
  if (
    memo?.components !== components ||
    memo.draft !== draft ||
    memo.ds !== ds
  ) {
    const drawn = drafted(components, draft);
    memo = {
      components,
      draft,
      ds,
      look: { components: drawn, css: designCss(drawn, ds) },
    };
  }
  return memo.look;
};

/** The look as it is now. */
const designLook = (): Look =>
  lookOf(
    useComponents.getState().components,
    useLookDraft.getState().draft,
    useDesignSystem.getState().designSystem
  );

/** Sets the look on `preview` now and whenever it changes; answers the function that stops it. */
export const followLook = (preview: Preview): (() => void) => {
  preview.setLook(designLook());
  const changed = () => preview.setLook(designLook());
  const stops = [
    useComponents.subscribe((now, before) => {
      if (now.components !== before.components) {
        changed();
      }
    }),
    useDesignSystem.subscribe((now, before) => {
      if (now.designSystem !== before.designSystem) {
        changed();
      }
    }),
    useLookDraft.subscribe(changed),
  ];
  return () => {
    for (const stop of stops) {
      stop();
    }
  };
};

/** The look as it changes: a new one only when the components, the draft or the design system do. */
export const useDesignLook = (): Look => {
  const designSystem = useDesignSystem((s) => s.designSystem);
  const components = useComponents((s) => s.components);
  const draft = useLookDraft((s) => s.draft);
  return useMemo(
    () => lookOf(components, draft, designSystem),
    [components, draft, designSystem]
  );
};

/** The components the server sent after a commit: the draft gives way to them. */
useComponents.subscribe((now, before) => {
  if (settling && now.components !== before.components) {
    settling = false;
    useLookDraft.setState({ draft: null });
  }
});

/**
 * Draws a part's style at a place as typed, until it is committed or let go (null): nothing is
 * sent. A draft committed is not let go: it stays drawn until the server's answer replaces it.
 */
export const draftStyle = (draft: StyleDraft | null) => {
  if (draft === null && settling) {
    return;
  }
  settling = false;
  useLookDraft.setState({ draft });
};

/**
 * Sends a part's style at a place as one `setStyle`, one undo step, drawn meanwhile as the draft
 * is: the draft gives way to the components the server sends back, or at once when it is refused.
 */
export const commitStyle = async (draft: StyleDraft): Promise<boolean> => {
  // Settling from now: the field closing as it commits does not let the draft go.
  settling = true;
  useLookDraft.setState({ draft });
  try {
    await api().request("components.change", {
      change: {
        op: "setStyle",
        place: draft.place,
        slot: draft.slot,
        style: draft.style,
      },
      name: draft.component,
    });
    // What the server sends back takes the draft's place; asked for, so it never waits.
    useComponents.getState().load();
    return true;
  } catch (error) {
    settling = false;
    useLookDraft.setState({ draft: null });
    reportError(error);
    return false;
  }
};
