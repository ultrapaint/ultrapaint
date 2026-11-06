/**
 * The look page's sample screens (ADR 0062): a day's list and a form of a small app, drawn with
 * the system components in the look the dials make, light and dark, so a dial is judged by what
 * it does to real screens rather than to swatches. How far apart things sit follows the density
 * and how a card stands apart follows the surfaces; every colour, radius and face is the look's
 * own token. Pure.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import { SYSTEM_FROM } from "@ultrapaint/contracts/component-names";
import type { DesignNode } from "@ultrapaint/contracts/document";
import type { LookDials } from "@ultrapaint/design-document/look-dials";
import { tokenRef } from "@ultrapaint/design-document/tokens";
import type { Board, Boards } from "./system-boards.ts";

/** How much room the density gives, against the regular one. */
const ROOM = { compact: 0.85, open: 1.2, regular: 1 } as const;

const FOREGROUND = tokenRef("color-foreground");
const MUTED = tokenRef("color-muted-foreground");

/** One sample's nodes, each id made unique by its board. */
const sample = (board: string, dials: LookDials) => {
  const room = ROOM[dials.density];
  const px = (size: number) => Math.round(size * room);
  let made = 0;
  const id = (what: string) => {
    made += 1;
    return `look-${board}-${what}-${made}`;
  };

  const text = (
    content: string,
    size: string,
    extra: Partial<Extract<DesignNode, { type: "text" }>> = {}
  ): DesignNode => ({
    color: FOREGROUND,
    id: id("text"),
    role: "paragraph",
    size: tokenRef(size),
    text: content,
    type: "text",
    ...extra,
  });

  const instance = (
    component: string,
    props: Readonly<Record<string, JsonValue>> = {},
    content?: string
  ): DesignNode => ({
    component,
    from: SYSTEM_FROM,
    id: id(component.toLowerCase()),
    props,
    ...(content === undefined ? {} : { text: content }),
    type: "instance",
  });

  /** A card as the surfaces set it apart: a hairline, a shadow, or its fill alone. */
  const card = (children: DesignNode[], gap = 0): DesignNode => ({
    children,
    fill: tokenRef("color-card"),
    gap: px(gap),
    id: id("card"),
    padding: px(16),
    radius: tokenRef("radius-lg"),
    type: "column",
    width: "fill",
    ...(dials.surfaces === "borders" && {
      border: { color: tokenRef("color-border"), width: 1 },
    }),
    ...(dials.surfaces === "shadows" && { shadow: tokenRef("shadow-sm") }),
  });

  const row = (children: DesignNode[], extra: object = {}): DesignNode => ({
    align: "between",
    children,
    crossAlign: "center",
    gap: px(12),
    id: id("row"),
    type: "row",
    width: "fill",
    ...extra,
  });

  const task = (name: string, meta: string, done: boolean, badge?: string) =>
    row(
      [
        {
          children: [
            instance("Checkbox", { checked: done }),
            {
              children: [
                text(name, "text-sm", { weight: 500 }),
                text(meta, "text-xs", { color: MUTED }),
              ],
              gap: 2,
              id: id("names"),
              type: "column",
            },
          ],
          crossAlign: "center",
          gap: px(12),
          id: id("task"),
          type: "row",
        },
        ...(badge ? [instance("Badge", { variant: "secondary" }, badge)] : []),
      ],
      { padding: { bottom: px(10), left: 0, right: 0, top: px(10) } }
    );

  return { card, instance, px, row, task, text };
};

/** The day's list: what the look does to a screen read every day. */
const today = (board: string, dials: LookDials): DesignNode => {
  const { card, instance, px, row, task, text } = sample(board, dials);
  return {
    children: [
      row([
        {
          children: [
            text("Today", "text-2xl", { role: "heading", weight: 600 }),
            text("Thursday, 5 November", "text-sm", {
              color: tokenRef("color-muted-foreground"),
            }),
          ],
          gap: 4,
          id: `look-${board}-title`,
          type: "column",
        },
        instance("Button", { size: "sm", variant: "primary" }, "Add a task"),
      ]),
      card([
        task("Send the invoice to Maple & Co", "Finance · due today", true),
        task("Review the onboarding copy", "Design · 3 comments", true),
        task(
          "Call the venue about the March workshop and confirm the numbers",
          "Events · 11:30",
          false,
          "Waiting"
        ),
        task("Plan next week", "Personal", false),
      ]),
    ],
    fill: tokenRef("color-background"),
    gap: px(24),
    id: `look-${board}-root`,
    padding: px(32),
    type: "column",
    width: 460,
  };
};

/** A form in a card: fields, a switch and the actions, where a look's controls show most. */
const form = (board: string, dials: LookDials): DesignNode => {
  const { card, instance, px, row, text } = sample(board, dials);
  return {
    children: [
      card(
        [
          {
            children: [
              text("New task", "text-lg", { role: "heading", weight: 600 }),
              text("It goes on today’s list.", "text-sm", {
                color: tokenRef("color-muted-foreground"),
              }),
            ],
            gap: 4,
            id: `look-${board}-head`,
            type: "column",
          },
          instance("Input", {
            label: "Name",
            placeholder: "Book the train to Leeds",
          }),
          instance("Input", { label: "Project", value: "Events" }),
          // Label left, the switch at the row's right edge.
          row([
            text("Remind me at 9:00", "text-sm", { weight: 500 }),
            instance("Switch", { checked: true }),
          ]),
          row(
            [
              instance("Button", { variant: "outline" }, "Cancel"),
              instance("Button", { variant: "primary" }, "Create task"),
            ],
            { align: "end", gap: px(8) }
          ),
        ],
        20
      ),
    ],
    fill: tokenRef("color-background"),
    id: `look-${board}-root`,
    padding: px(32),
    type: "column",
    width: 400,
  };
};

/** The samples, side by side: the list and the form in light, the list in dark. */
export const lookBoards = (dials: LookDials): Boards => {
  const boards: Board[] = [
    {
      name: "today",
      root: today("today", dials),
      theme: "light",
      title: "Today",
    },
    {
      name: "form",
      root: form("form", dials),
      theme: "light",
      title: "New task",
    },
    {
      name: "today-dark",
      root: today("today-dark", dials),
      theme: "dark",
      title: "Today, dark",
    },
  ];
  return { boards, direction: "row" };
};
