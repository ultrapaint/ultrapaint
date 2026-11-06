/**
 * The look page's panel (ADR 0062), in the Design system place while its samples are open: where
 * a look starts from, its dials, an agent asked to make it from a description or a site, and the
 * way out, using the look or leaving it to the agent. Every dial is drawn on the samples at once.
 */

import type { TokenPreset } from "@ultrapaint/contracts/token-presets";
import {
  type Corners,
  type Density,
  type Greys,
  type IconStroke,
  LOOK_PRESETS,
  type LookDials,
  presetOf,
  type Surfaces,
  TYPEFACES,
} from "@ultrapaint/design-document/look-dials";
import { ArrowUp, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { IconButton } from "../components/icon-button.tsx";
import { OptionSelect } from "../components/option-select.tsx";
import { Segmented } from "../components/segmented.tsx";
import {
  describeTheLook,
  letTheAgentDecide,
  saveTheLook,
} from "../lib/look-page.ts";
import { leaveBoard } from "../state/board.ts";
import { hideLookPage, setDials, useLookPage } from "../state/look-page.ts";

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** A dial: its name over its control. */
const Dial = ({ children, label }: { children: ReactNode; label: string }) => (
  // biome-ignore lint/a11y/noLabelWithoutControl: the control is inside, whichever it is
  <label className="flex flex-col gap-1.5">
    <span className="font-small text-muted-foreground">{label}</span>
    {children}
  </label>
);

const choices = <T extends string>(...values: readonly T[]) =>
  values.map((value) => ({
    label: value.charAt(0).toUpperCase() + value.slice(1),
    value,
  }));

/** The brand colour: a swatch that opens the system's picker, and its hex to type. */
const BrandColour = ({ brand }: { brand: string }) => {
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <span className="relative size-7 shrink-0 overflow-hidden rounded-md ring-1 ring-border">
        <span className="absolute inset-0" style={{ background: brand }} />
        <input
          aria-label="Pick the brand colour"
          className="absolute inset-0 cursor-pointer opacity-0"
          onChange={(e) => setDials({ brand: e.target.value })}
          type="color"
          value={HEX_RE.test(brand) ? brand : "#000000"}
        />
      </span>
      <Input
        aria-label="Brand colour"
        className="h-7 font-code"
        onBlur={() => setTyped(null)}
        onChange={(e) => {
          const next = e.target.value.trim();
          setTyped(next);
          if (HEX_RE.test(next)) {
            setDials({ brand: next.toLowerCase() });
          }
        }}
        spellCheck={false}
        value={typed ?? brand}
      />
    </div>
  );
};

const Dials = ({ dials }: { dials: LookDials }) => (
  <div className="flex flex-col gap-4 px-4 pb-4">
    <Dial label="Start from">
      <Segmented
        onChange={(name) => {
          const preset = LOOK_PRESETS.find((p) => p.name === name);
          if (preset) {
            // How the colours are named is the person's, whatever the preset.
            setDials({ ...preset.dials, tokens: dials.tokens });
          }
        }}
        options={LOOK_PRESETS.map((p) => ({ label: p.name, value: p.name }))}
        value={presetOf(dials)?.name ?? null}
      />
    </Dial>
    <Dial label="Brand colour">
      <BrandColour brand={dials.brand} />
    </Dial>
    <Dial label="Greys">
      <Segmented<Greys>
        onChange={(greys) => setDials({ greys })}
        options={choices("warm", "neutral", "cool")}
        value={dials.greys}
      />
    </Dial>
    <Dial label="Corners">
      <Segmented<Corners>
        onChange={(corners) => setDials({ corners })}
        options={choices("sharp", "soft", "round")}
        value={dials.corners}
      />
    </Dial>
    <Dial label="Density">
      <Segmented<Density>
        onChange={(density) => setDials({ density })}
        options={choices("compact", "regular", "open")}
        value={dials.density}
      />
    </Dial>
    <Dial label="Surfaces">
      <Segmented<Surfaces>
        onChange={(surfaces) => setDials({ surfaces })}
        options={choices("flat", "borders", "shadows")}
        value={dials.surfaces}
      />
    </Dial>
    <Dial label="Typeface">
      <OptionSelect
        onChange={(typeface) => setDials({ typeface })}
        options={TYPEFACES.map((t) => ({ label: t.name, value: t.name }))}
        size="sm"
        value={dials.typeface}
      />
    </Dial>
    <Dial label="Icon stroke">
      <Segmented<IconStroke>
        onChange={(iconStroke) => setDials({ iconStroke })}
        options={choices("light", "regular", "bold")}
        value={dials.iconStroke}
      />
    </Dial>
    <Dial label="Tokens">
      <Segmented<TokenPreset>
        onChange={(tokens) => setDials({ tokens })}
        options={choices("simple", "detailed")}
        value={dials.tokens}
      />
      <span className="font-small text-muted-foreground">
        {dials.tokens === "simple"
          ? "primary, muted-foreground, border: shadcn’s roles"
          : "text-subtle, bg-danger-subtle, border-focus: by property, as Atlassian’s"}
      </span>
    </Dial>
  </div>
);

/** An agent asked to make the look from a description or a site, instead of the dials. */
const Describe = ({ busy }: { busy: boolean }) => {
  const [text, setText] = useState("");
  const send = () => {
    if (text.trim()) {
      describeTheLook(text);
    }
  };
  return (
    <div className="relative">
      <Textarea
        aria-label="Describe the look"
        className="min-h-14 pr-9 font-small"
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        placeholder="Or describe it, or name a site: like linear.app, but warmer"
        value={text}
      />
      <Button
        aria-label="Ask an agent for this look"
        className="absolute right-1.5 bottom-1.5 size-6 rounded-full"
        disabled={busy || !text.trim()}
        onClick={send}
        size="icon"
      >
        <ArrowUp />
      </Button>
    </div>
  );
};

export const LookPanel = () => {
  const dials = useLookPage((s) => s.dials);
  const pending = useLookPage((s) => s.pending);
  const [busy, setBusy] = useState(false);
  const choose = async () => {
    setBusy(true);
    await saveTheLook();
    setBusy(false);
  };
  const close = () => {
    hideLookPage();
    leaveBoard();
  };
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-0.5 pr-2 pl-4">
        <h2 className="flex-1 truncate font-heading-xsmall">Choose a look</h2>
        {pending ? null : (
          <IconButton
            className="text-muted-foreground"
            onClick={close}
            tooltip="Close"
          >
            <X />
          </IconButton>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Dials dials={dials} />
      </div>
      <div className="flex shrink-0 flex-col gap-3 border-t px-4 pt-3 pb-4">
        <Describe busy={busy} />
        <div className="flex justify-end gap-2">
          <Button
            disabled={busy}
            onClick={letTheAgentDecide}
            size="sm"
            variant="ghost"
          >
            Let the agent decide
          </Button>
          <Button disabled={busy} onClick={choose} size="sm">
            {busy ? <Spinner /> : null}
            {busy ? "Saving…" : "Use this look"}
          </Button>
        </div>
      </div>
    </div>
  );
};
