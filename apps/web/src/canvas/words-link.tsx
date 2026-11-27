/**
 * Where some words of a text lead (ADR 0163): ⌘K with words selected in a text edited in place
 * asks for it, and the inspector's own "Goes to" field opens in a popover by them, as the Vibe
 * toolbar's link button opens it for an element. What is picked becomes a run of the text that
 * links; Nowhere takes the words' link off.
 */
import {
  asSet,
  linkThrough,
  linkWords,
  runsOf,
  type WordsRange,
} from "@ultrapaint/design-document/text-runs";
import { findNode } from "@ultrapaint/design-document/tree";
import type { FrameRect } from "@ultrapaint/preview-core/preview";
import { create } from "zustand";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { LinkField } from "../components/link-field.tsx";
import { updateNodesWith } from "../lib/node-actions.ts";
import { Row, Section } from "../panels/inspector-fields.tsx";
import { rootOfFrame, useDocuments } from "../state/documents.ts";
import { useEditor } from "../state/editor.ts";

/** The words asked about: a text of a frame, the stretch of its words, and where they are drawn. */
export interface WordsAsked extends WordsRange {
  /** Where the words are drawn, in the editor's page's pixels. */
  readonly anchor: FrameRect;
  readonly frame: string;
  readonly nodeId: string;
}

const useWordsLink = create<{ asked: WordsAsked | null }>(() => ({
  asked: null,
}));

/** Opens the "Goes to" popover by these words. */
export const askWordsLink = (asked: WordsAsked) =>
  useWordsLink.setState({ asked });

const close = () => useWordsLink.setState({ asked: null });

/** The popover, by the words asked about while they are. */
export const WordsLinkPopover = () => {
  const asked = useWordsLink((s) => s.asked);
  const docs = useDocuments((s) => s.docs);
  const canvas = useEditor((s) => s.canvas);
  const node = asked
    ? findNode(rootOfFrame(docs, canvas, asked.frame), asked.nodeId)
    : null;
  if (!(asked && node?.type === "text")) {
    return null;
  }
  const { anchor } = asked;
  const virtual = {
    getBoundingClientRect: () =>
      DOMRect.fromRect({
        height: anchor.height,
        width: anchor.width,
        x: anchor.x,
        y: anchor.y,
      }),
  };
  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
      open
    >
      <PopoverContent anchor={virtual} className="w-72 gap-0 p-0" side="bottom">
        <Section title="Prototype">
          <Row label="Goes to">
            {node.link ? (
              <p className="font-body-small text-muted-foreground">
                The whole text leads somewhere: take its link off to link some
                of its words.
              </p>
            ) : (
              <LinkField
                link={linkThrough(runsOf(node), asked)}
                onChange={(link) => {
                  close();
                  updateNodesWith(
                    [{ frame: asked.frame, nodeId: asked.nodeId }],
                    (drawn) => {
                      const words =
                        drawn.type === "text"
                          ? linkWords(drawn, asked, link)
                          : null;
                      return words ? asSet(words) : {};
                    },
                    link === null ? "Remove the link" : "Link"
                  );
                }}
              />
            )}
          </Row>
        </Section>
      </PopoverContent>
    </Popover>
  );
};
