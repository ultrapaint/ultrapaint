/**
 * Design system's inspectors on a board (ADR 0045, B7): what is picked on a foundation's boards,
 * edited live. A token: its value in each theme (a colour picker beside the text for a colour),
 * its description, its group, where it is used, and for a colour "Generate ramp from…"; a colour
 * group: its name, a token added to it, its ramp generated; a text style: its font, size, weight,
 * leading and tracking as token pickers. With nothing picked, a token or a group added to the
 * foundation open.
 *
 * A value is drawn as it is typed (`draftEdits`, every frame following) and committed on Enter
 * or when the field is left, one `designSystem.edit` and one undo step (`commitEdits`); Escape
 * lets it go. A picker's choice is committed as it is made.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import {
  type DesignSystem,
  TEXT_STYLE_SETTINGS,
  type TextStyle,
  type TextStyleSetting,
} from "@ultrapaint/contracts/design-system";
import {
  tokenKindOf,
  tokenOf,
  tokenPrefix,
} from "@ultrapaint/contracts/token-table";
import { hexOf, parseColor } from "@ultrapaint/contracts/token-value";
import { Component, File, Palette, Type } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { stepOf } from "../boards/color-boards.ts";
import { type Pick, pickId } from "../boards/pick.ts";
import { FOUNDATIONS } from "../boards/system-boards.ts";
import { OptionSelect } from "../components/option-select.tsx";
import { Row, Section } from "../components/panel.tsx";
import {
  ownValueIn,
  rampEdits,
  type TokenUse,
  textStyleOp,
  themesOf,
  usesOf,
  valueOp,
} from "../lib/token-ops.ts";
import { type FieldTokenKind, Swatch } from "../lib/token-options.tsx";
import { pickOf, pickOnBoard, useBoard } from "../state/board.ts";
import { useComponents } from "../state/components.ts";
import {
  commitEdits,
  draftEdits,
  useDesignSystem,
} from "../state/design-system.ts";
import { useDocuments } from "../state/documents.ts";
import { useProject } from "../state/project.ts";
import { TextInput, TokenField } from "./inspector-fields.tsx";

const FIRST_STEP = /-50$/;
const NOT_SLUG = /[^a-z0-9]+/g;

/** A colour's value as the picker takes it: `#rrggbb`, or black for what is no colour. */
const pickerHex = (css: string | undefined) => {
  const color = css ? parseColor(css) : null;
  return color ? hexOf(color).slice(0, 7) : "#000000";
};

/** Re-picks on the board what was renamed: the pick follows the group. */
const repick = (picked: Pick) => {
  const was = pickOf(useBoard.getState());
  if (was) {
    pickOnBoard({ frame: was.frame, nodeId: pickId(picked) });
  }
};

/**
 * A token's value in one theme: the text, and a colour picker for a colour. Drawn as typed;
 * committed on Enter or on leaving; another theme's left empty takes the default's.
 */
const ThemeValue = ({
  ds,
  name,
  theme,
}: {
  ds: DesignSystem;
  name: string;
  theme: string;
}) => {
  const first = theme === themesOf(ds)[0];
  const own = ownValueIn(ds, name, theme);
  const fallback = tokenOf(ds, name)?.value;
  // What the field held when typing began, and what is typed since; null while it is not typed in.
  const [typed, setTyped] = useState<{ from: string; text: string } | null>(
    null
  );
  // The same, read on leaving the field: Escape lets it go before the field is left.
  const typing = useRef<{ from: string; text: string } | null>(null);
  const opOf = (text: string) =>
    valueOp(ds, name, theme, text.trim() === "" && !first ? null : text);
  const type = (text: string) => {
    typing.current = { from: typing.current?.from ?? own ?? "", text };
    setTyped(typing.current);
    draftEdits(text.trim() === "" && first ? null : [opOf(text)]);
  };
  const commit = () => {
    const done = typing.current;
    typing.current = null;
    setTyped(null);
    if (!done) {
      return;
    }
    if (done.text.trim() === done.from.trim() || (first && !done.text.trim())) {
      draftEdits(null);
      return;
    }
    commitEdits([opOf(done.text)]);
  };
  const cancel = () => {
    typing.current = null;
    setTyped(null);
    draftEdits(null);
  };
  const isColor = tokenKindOf(name) === "color";
  const shown = typed?.text ?? own ?? "";
  return (
    <Row label={theme.charAt(0).toUpperCase() + theme.slice(1)}>
      {isColor ? (
        <label
          className="relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-md border border-input"
          style={{ background: shown || fallback }}
          title={`Pick ${name} in ${theme}`}
        >
          <input
            aria-label={`${name} in ${theme}`}
            className="absolute inset-0 cursor-pointer opacity-0"
            // Drawn as it is dragged; committed once the picker is left.
            onBlur={commit}
            onChange={(e) => type(e.target.value)}
            type="color"
            value={pickerHex(shown || fallback)}
          />
        </label>
      ) : null}
      <Input
        aria-label={`${name}'s value in ${theme}`}
        className="h-7 font-code"
        onBlur={commit}
        onChange={(e) => type(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            cancel();
            e.currentTarget.blur();
          }
        }}
        placeholder={first ? undefined : `As ${themesOf(ds)[0]}: ${fallback}`}
        value={shown}
      />
    </Row>
  );
};

/** The pages of the canvas open the editor has read, named, for what counts their uses. */
export const usePagesRead = () => {
  const docs = useDocuments((s) => s.docs);
  const pages = useProject((s) => s.pages);
  return useMemo(
    () =>
      Object.values(docs).map((d) => ({
        name:
          pages.find((p) => p.id === d.doc)?.name ??
          d.doc.split("/").at(-1) ??
          d.doc,
        root: d.root,
      })),
    [docs, pages]
  );
};

/**
 * Where something is used, the first few by name: a page, with what it counts there (`count`
 * says it, or nothing), a component, a text style.
 */
export const UsesSection = ({
  count,
  uses,
}: {
  count: (use: TokenUse) => string | null;
  uses: readonly TokenUse[];
}) => {
  const SHOWN = 3;
  return (
    <Section title="Used in">
      <span className="font-body text-muted-foreground">
        {uses.length === 0
          ? "Nowhere on this canvas yet"
          : `${uses.length} ${uses.length === 1 ? "place" : "places"}`}
      </span>
      {uses.slice(0, SHOWN).map((use) => (
        <span
          className="flex items-center gap-1.5 font-body [&_svg]:size-3.5 [&_svg]:text-muted-foreground"
          key={`${use.kind}:${use.name}`}
        >
          {use.kind === "page" ? <File /> : null}
          {use.kind === "component" ? <Component /> : null}
          {use.kind === "style" ? <Type /> : null}
          <span className="truncate">{use.name}</span>
          <span className="text-muted-foreground">{count(use)}</span>
        </span>
      ))}
      {uses.length > SHOWN ? (
        <span className="font-body text-muted-foreground">
          {uses.length - SHOWN} more
        </span>
      ) : null}
    </Section>
  );
};

/** How many of a page's nodes name a token. */
const nodesCount = (use: TokenUse) =>
  use.kind === "page"
    ? `${use.count} ${use.count === 1 ? "node" : "nodes"}`
    : null;

/** Where a token is used: the pages of the canvas open, the components, the text styles. */
const UsedIn = ({ name }: { name: string }) => {
  const ds = useDesignSystem((s) => s.designSystem);
  const pages = usePagesRead();
  const components = useComponents((s) => s.components);
  const uses = useMemo(
    () => usesOf(name, { components, ds, pages }),
    [name, components, ds, pages]
  );
  return <UsesSection count={nodesCount} uses={uses} />;
};

/**
 * "Generate ramp from…": one colour gives a palette's eleven shades in each theme, shown here
 * and drawn on the board before Apply makes them one edit; Cancel lets them go.
 */
const RampSection = ({ ds, name }: { ds: DesignSystem; name: string }) => {
  const [base, setBase] = useState<string | null>(null);
  // Made from the design system as saved: the shades drawn are a draft over it.
  const saved = useDesignSystem((s) => s.saved);
  const made = useMemo(
    () => (base === null || !saved ? null : rampEdits(saved, name, base)),
    [saved, name, base]
  );
  // The shades drawn on the board while they are only proposed.
  const proposing = useRef<boolean>(false);
  useEffect(() => {
    if (base !== null) {
      proposing.current = true;
      draftEdits(made?.ops ?? null);
    }
  }, [base, made]);
  // Left while proposing (another pick), the shades go with it.
  useEffect(
    () => () => {
      if (proposing.current) {
        draftEdits(null);
      }
    },
    []
  );
  const start = () => setBase(tokenOf(ds, name)?.value ?? "#3b82f6");
  const stop = () => {
    proposing.current = false;
    setBase(null);
    draftEdits(null);
  };
  const apply = async () => {
    if (!made) {
      return;
    }
    proposing.current = false;
    setBase(null);
    await commitEdits(made.ops, `Generate the ${made.palette.group} ramp`);
  };
  return (
    <Section title="Ramp">
      {base === null ? (
        <Button onClick={start} size="sm" variant="outline">
          <Palette />
          Generate ramp from…
        </Button>
      ) : (
        <>
          <Row label="From">
            <Swatch color={made ? base : undefined} />
            <Input
              aria-label="The colour the ramp is made from"
              className="h-7 font-code"
              onChange={(e) => setBase(e.target.value)}
              value={base}
            />
          </Row>
          {made ? (
            themesOf(ds).map((theme) => (
              <div className="flex flex-col gap-1" key={theme}>
                <span className="font-body text-muted-foreground">{theme}</span>
                <div className="flex gap-0.5">
                  {made.shades.map((shade) => (
                    <span
                      className="h-5 flex-1 rounded-sm"
                      key={shade.step}
                      style={{ background: shade.values[theme] }}
                      title={`${shade.name}: ${shade.values[theme]}`}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <span className="font-body text-muted-foreground">
              Give a colour: hex, rgb() or oklch().
            </span>
          )}
          {made ? (
            <span className="font-body text-muted-foreground">
              {made.shades.length} shades,{" "}
              {made.shades[0]?.name.replace(FIRST_STEP, "-50…950")} in{" "}
              {made.palette.group}
              {made.palette.exists ? "" : " (a new group)"}.
            </span>
          ) : null}
          <div className="flex gap-1.5">
            <Button disabled={!made} onClick={apply} size="sm">
              Apply
            </Button>
            <Button onClick={stop} size="sm" variant="ghost">
              Cancel
            </Button>
          </div>
        </>
      )}
    </Section>
  );
};

export const TokenInspector = ({
  ds,
  name,
}: {
  ds: DesignSystem;
  name: string;
}) => {
  const token = tokenOf(ds, name);
  if (!token) {
    return (
      <p className="p-3 font-body text-muted-foreground">
        The design system has no token {name}.
      </p>
    );
  }
  const kind = tokenKindOf(name);
  const group = ds.colors.find((g) => g.tokens.some((t) => t.name === name));
  // The spacing base is one value in every theme.
  const themes = name === "spacing" ? themesOf(ds).slice(0, 1) : themesOf(ds);
  return (
    <>
      <Section title="Value">
        {themes.map((theme) => (
          <ThemeValue ds={ds} key={theme} name={name} theme={theme} />
        ))}
      </Section>
      {name === "spacing" ? null : (
        <Section title="Description">
          <TextInput
            multiline
            onChange={(description) =>
              commitEdits([{ description, name, op: "setDescription" }])
            }
            placeholder="What it is for"
            value={token.description}
          />
        </Section>
      )}
      {group ? (
        <Section title="Group">
          <OptionSelect
            onChange={(to) =>
              commitEdits([{ group: to, name, op: "moveToken" }])
            }
            options={ds.colors.map((g) => ({ label: g.name, value: g.name }))}
            value={group.name}
          />
        </Section>
      ) : null}
      <UsedIn name={name} />
      {kind === "color" ? <RampSection ds={ds} name={name} /> : null}
    </>
  );
};

/** A token's name and value, added to a group or a foundation's list as one edit. */
const AddToken = ({
  ds,
  group,
  prefix,
}: {
  ds: DesignSystem;
  group?: string;
  prefix: string;
}) => {
  const [name, setName] = useState(prefix);
  const [value, setValue] = useState("");
  const taken = tokenOf(ds, name) !== undefined;
  const ready = name.length > prefix.length && value.trim() !== "" && !taken;
  const add = async () => {
    if (
      await commitEdits([
        { name, op: "addToken", value, ...(group !== undefined && { group }) },
      ])
    ) {
      setName(prefix);
      setValue("");
    }
  };
  return (
    <Section title="Add a token">
      <Row label="Name">
        <Input
          aria-label="The new token's name"
          className="h-7 font-code"
          onChange={(e) => setName(e.target.value)}
          value={name}
        />
      </Row>
      <Row label="Value">
        <Input
          aria-label="The new token's value"
          className="h-7 font-code"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && ready) {
              add();
            }
          }}
          value={value}
        />
      </Row>
      {taken ? (
        <span className="font-body text-muted-foreground">
          {name} is there already.
        </span>
      ) : null}
      <Button disabled={!ready} onClick={add} size="sm" variant="outline">
        Add
      </Button>
    </Section>
  );
};

/** A colour group: its name, a token added to it, and its ramp. */
export const GroupInspector = ({
  ds,
  name,
}: {
  ds: DesignSystem;
  name: string;
}) => {
  const group = ds.colors.find((g) => g.name === name);
  if (!group) {
    return (
      <p className="p-3 font-body text-muted-foreground">
        There is no group {name}.
      </p>
    );
  }
  const shade = group.tokens.find((t) => stepOf(t.name) !== null);
  const slug = name.toLowerCase().replace(NOT_SLUG, "-");
  return (
    <>
      <Section title="Name">
        <TextInput
          onChange={async (to) => {
            if (
              to.trim() &&
              (await commitEdits([{ name, op: "renameGroup", to: to.trim() }]))
            ) {
              repick({ kind: "group", name: to.trim() });
            }
          }}
          value={name}
        />
        <span className="font-body text-muted-foreground">
          {group.tokens.length}{" "}
          {group.tokens.length === 1 ? "colour" : "colours"}
        </span>
      </Section>
      <AddToken
        ds={ds}
        group={name}
        prefix={
          shade
            ? `${shade.name.slice(0, -`${stepOf(shade.name)}`.length)}`
            : `color-${slug}-`
        }
      />
      <RampSection ds={ds} name={shade?.name ?? `color-${slug}`} />
    </>
  );
};

/** A text style's settings and the token kinds their pickers offer. */
const STYLE_FIELDS: readonly {
  readonly kind: FieldTokenKind;
  readonly label: string;
  readonly setting: TextStyleSetting;
}[] = [
  { kind: "font", label: "Font", setting: "font" },
  { kind: "fontSize", label: "Size", setting: "size" },
  { kind: "fontWeight", label: "Weight", setting: "weight" },
  { kind: "leading", label: "Leading", setting: "lineHeight" },
  { kind: "tracking", label: "Tracking", setting: "tracking" },
];

/** A text style's font, size, weight, leading and tracking, each picked from its tokens. */
export const TextStyleInspector = ({
  ds,
  name,
}: {
  ds: DesignSystem;
  name: string;
}) => {
  const style = ds.typography.styles.find((s) => s.name === name);
  if (!style) {
    return (
      <p className="p-3 font-body text-muted-foreground">
        There is no text style {name}.
      </p>
    );
  }
  const set = (setting: TextStyleSetting, value: JsonValue) =>
    commitEdits([textStyleOp(style, setting, value)]);
  return (
    <>
      <Section title="Type">
        {STYLE_FIELDS.filter((f) =>
          (TEXT_STYLE_SETTINGS as readonly string[]).includes(f.setting)
        ).map((f) => (
          <Row key={f.setting} label={f.label}>
            <TokenField
              field={f.setting}
              kind={f.kind}
              numeric={f.setting !== "font"}
              onChange={(v) => set(f.setting, v)}
              placeholder="From the page"
              value={style[f.setting]}
            />
          </Row>
        ))}
      </Section>
      <Section title="Description">
        <TextInput
          multiline
          onChange={(description) => {
            const { description: _was, ...rest } = style;
            commitEdits([
              {
                op: "setTextStyle",
                style: (description.trim()
                  ? { ...rest, description: description.trim() }
                  : rest) as TextStyle,
              },
            ]);
          }}
          placeholder="What it is for"
          value={style.description}
        />
      </Section>
    </>
  );
};

/** With nothing picked on a foundation: what can be added to it. */
export const FoundationActions = ({
  ds,
  item,
}: {
  ds: DesignSystem;
  item: string;
}) => {
  const [group, setGroup] = useState("");
  const foundation = FOUNDATIONS.find((f) => f.id === item);
  if (!foundation) {
    return null;
  }
  if (item === "color") {
    const add = async () => {
      if (await commitEdits([{ name: group.trim(), op: "addGroup" }])) {
        setGroup("");
      }
    };
    const taken = ds.colors.some((g) => g.name === group.trim());
    return (
      <Section title="Add a group">
        <Input
          aria-label="The new group's name"
          className="h-7"
          onChange={(e) => setGroup(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && group.trim() && !taken) {
              add();
            }
          }}
          placeholder="accent"
          value={group}
        />
        <Button
          disabled={!group.trim() || taken}
          onClick={add}
          size="sm"
          variant="outline"
        >
          Add
        </Button>
      </Section>
    );
  }
  const [kind] = foundation.kinds;
  return kind ? (
    <AddToken ds={ds} key={item} prefix={tokenPrefix(kind)} />
  ) : null;
};

/** What a picked token is called under its name: its kind's. */
export const tokenKindLabel = (name: string) => {
  const kind = tokenKindOf(name);
  const known: Partial<Record<string, string>> = {
    borderWidth: "Border width",
    breakpoint: "Breakpoint",
    color: "Color",
    container: "Container",
    duration: "Duration",
    easing: "Easing",
    font: "Font",
    fontSize: "Font size",
    fontWeight: "Font weight",
    leading: "Line height",
    radius: "Radius",
    shadow: "Shadow",
    spacing: "Spacing",
    tracking: "Tracking",
  };
  return `${known[kind] ?? "Design"} token`;
};
