/**
 * A guideline's text, edited beside its board (ADR 0045): the section of DESIGN.md as markdown,
 * drawn on the board as it is typed (`setGuideDraft`) and written when the field is left,
 * `designSystem.setSection`, one undo step. Escape lets the typing go.
 */
import type { DesignDocument } from "@ultrapaint/contracts/design-system";
import { useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { guidelineId } from "../boards/system-boards.ts";
import { Section } from "../components/panel.tsx";
import { setGuideDraft } from "../state/board.ts";
import { api } from "../state/connection.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { reportError } from "../state/project.ts";

export const GuidelineEditor = ({
  document,
  item,
}: {
  document: DesignDocument | null;
  item: string;
}) => {
  const section = document?.sections.find(
    (s) => guidelineId(s.heading) === item
  );
  const [typed, setTyped] = useState<string | null>(null);
  // What is typed, read on leaving: Escape lets it go before the field is left.
  const typing = useRef<string | null>(null);
  if (!section) {
    return (
      <p className="p-3 font-body text-muted-foreground">
        DESIGN.md has no such section.
      </p>
    );
  }
  const type = (text: string) => {
    typing.current = text;
    setTyped(text);
    setGuideDraft({ item, text });
  };
  const save = async () => {
    const text = typing.current;
    typing.current = null;
    if (text === null) {
      return;
    }
    if (text.trim() === section.text.trim()) {
      setTyped(null);
      setGuideDraft(null);
      return;
    }
    try {
      await api().request("designSystem.setSection", {
        name: section.heading,
        text,
      });
      // The board draws the typing until DESIGN.md is read again with it.
      await useDesignSystem.getState().load();
    } catch (error) {
      reportError(error);
    }
    setTyped(null);
    setGuideDraft(null);
  };
  return (
    <Section className="flex min-h-0 flex-1 flex-col border-b-0" title="Text">
      <Textarea
        aria-label={`${section.heading} in DESIGN.md`}
        className="min-h-80 flex-1 resize-none font-code"
        onBlur={save}
        onChange={(e) => type(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            typing.current = null;
            setTyped(null);
            setGuideDraft(null);
            e.currentTarget.blur();
          }
        }}
        value={typed ?? section.text}
      />
      <span className="font-body text-muted-foreground">
        Markdown, written to DESIGN.md when you leave the field.
      </span>
    </Section>
  );
};
