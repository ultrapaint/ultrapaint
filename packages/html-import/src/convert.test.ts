import {
  type DesignSystem,
  emptyDesignSystem,
} from "@ultrapaint/contracts/design-system";
import { tailwindClassReader } from "@ultrapaint/style-tailwind-v4/class-reader";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { convertHtml } from "./convert.ts";

const base = emptyDesignSystem();
const ds: DesignSystem = {
  ...base,
  colors: [
    {
      name: "Semantic",
      tokens: [
        { name: "color-primary", value: "#2b7fff" },
        { name: "color-ink", value: "#111111" },
      ],
    },
  ],
  radius: [{ name: "radius-lg", value: "0.5rem" }],
};

/** Pasted markup as layers, ids counted from 1 so a test can name them. */
const paste = (html: string, designSystem: DesignSystem | null = ds) => {
  const document = new new Window().DOMParser().parseFromString(
    html,
    "text/html"
  ) as unknown as Document;
  let n = 0;
  return convertHtml(document, {
    classes: tailwindClassReader(designSystem),
    designSystem,
    next: (prefix = "n") => {
      n += 1;
      return `${prefix}_${n}`;
    },
  });
};

/** The kinds of warnings and how many of each. */
const warned = (html: string) =>
  Object.fromEntries(paste(html).warnings.map((w) => [w.kind, w.count]));

describe("pasting HTML as layers", () => {
  it("turns a vertical flex with a heading, a paragraph and an image into a column of them", () => {
    expect(
      paste(`<div class="flex flex-col gap-4 p-6">
        <h2>Pricing</h2>
        <p>Pay as you go.</p>
        <img src="https://example.com/hero.png" alt="A hero">
      </div>`)
    ).toEqual({
      nodes: [
        {
          children: [
            {
              id: "t_1",
              level: 2,
              role: "heading",
              text: "Pricing",
              type: "text",
            },
            {
              id: "t_2",
              role: "paragraph",
              text: "Pay as you go.",
              type: "text",
            },
            {
              alt: "A hero",
              id: "img_3",
              src: "https://example.com/hero.png",
              type: "image",
            },
          ],
          gap: "$spacing-4",
          id: "c_4",
          padding: "$spacing-6",
          type: "column",
        },
      ],
      warnings: [],
    });
  });

  it("turns a horizontal flex into a row with its gap, alignment and wrap", () => {
    const [row] = paste(
      `<nav style="display: flex; gap: 12px; justify-content: space-between; align-items: center; flex-wrap: wrap"><a>Home</a><a>Docs</a></nav>`
    ).nodes;
    expect(row).toMatchObject({
      align: "between",
      children: [{ text: "Home" }, { text: "Docs" }],
      crossAlign: "center",
      gap: "$spacing-3",
      type: "row",
      wrap: true,
    });
  });

  it("makes each child of a flex an item of its own, with its own look", () => {
    expect(
      paste(
        `<div class="flex gap-3"><a class="rounded-lg bg-primary px-4 py-2">Buy</a> <a class="border">Learn</a></div>`
      ).nodes
    ).toMatchObject([
      {
        children: [
          { fill: "$color-primary", radius: "$radius-lg", text: "Buy" },
          { border: { style: "solid", width: 1 }, text: "Learn" },
        ],
        type: "row",
      },
    ]);
  });

  it("puts an inline element whose display is a block on a line of its own", () => {
    expect(
      paste(
        `<div><span class="block">Title</span><span class="block">Sub</span></div>`
      ).nodes
    ).toMatchObject([{ children: [{ text: "Title" }, { text: "Sub" }] }]);
  });

  it("lays a grid's rows out as a column with its gap, and says so", () => {
    const { nodes, warnings } = paste(
      `<div class="grid gap-4"><p>One</p><p>Two</p></div>`
    );
    expect(nodes).toMatchObject([{ gap: "$spacing-4", type: "column" }]);
    expect(warnings).toEqual([expect.objectContaining({ kind: "grid" })]);
  });

  it("turns a block of blocks into a column", () => {
    expect(
      paste("<section><div>One</div><div>Two</div></section>").nodes
    ).toMatchObject([
      {
        children: [{ text: "One" }, { text: "Two" }],
        type: "column",
      },
    ]);
  });

  it("stacks children that are all positioned absolutely in a group, in reading order, and says so", () => {
    const { nodes, warnings } = paste(`<div class="relative h-[200px]">
      <span class="absolute left-[120px] top-[10px]">Right</span>
      <span style="position: absolute; left: 10px; top: 10px">Left</span>
      <span class="absolute left-[10px] top-[80px]">Below</span>
    </div>`);
    expect(nodes).toMatchObject([
      {
        children: [{ text: "Left" }, { text: "Right" }, { text: "Below" }],
        height: 200,
        type: "group",
      },
    ]);
    expect(warnings).toEqual([
      expect.objectContaining({ count: 1, kind: "positions" }),
    ]);
  });

  it("warns of a child positioned absolutely among others, which goes in the flow", () => {
    const { nodes, warnings } = paste(
      `<div class="relative p-4"><h3>Plan</h3><span class="absolute top-2 right-2">New</span></div>`
    );
    expect(nodes).toMatchObject([
      { children: [{ text: "Plan" }, { text: "New" }], type: "column" },
    ]);
    expect(warnings).toEqual([
      expect.objectContaining({ count: 1, kind: "inFlow" }),
    ]);
  });

  it("lets the inline style win over a class for the same field", () => {
    const [text] = paste(
      `<p class="p-4 bg-primary text-white" style="padding-left: 13px; background-color: #ff0000">Hi</p>`
    ).nodes;
    expect(text).toMatchObject({
      color: "#fff",
      fill: "#ff0000",
      padding: {
        bottom: "$spacing-4",
        left: 13,
        right: "$spacing-4",
        top: "$spacing-4",
      },
    });
  });

  it("writes a value the design system has a token for as the first token that holds it", () => {
    const [text] = paste(
      `<p style="color: rgb(43, 127, 255); background: #111; border-radius: 8px; padding: 16px; margin-top: 13px">Hi</p>`
    ).nodes;
    expect(text).toMatchObject({
      color: "$color-primary",
      fill: "$color-ink",
      margin: { top: 13 },
      padding: "$spacing-4",
      radius: "$radius-lg",
    });
  });

  it("writes a fill copied from a browser, in rgb(), as the token that holds it", () => {
    const [text] = paste(
      `<p style="background-color: rgb(43, 127, 255)">Hi</p>`
    ).nodes;
    expect(text).toMatchObject({ fill: "$color-primary" });
  });

  it("keeps a value with no token as it is", () => {
    const [text] = paste(
      `<p style="color: #abcdef; border-radius: 3px">Hi</p>`
    ).nodes;
    expect(text).toMatchObject({ color: "#abcdef", radius: 3 });
  });

  it("gives a text the settings it inherits, a heading its level", () => {
    expect(
      paste(
        `<div class="text-primary font-bold text-center"><h3>Title</h3><span>Note</span></div>`
      ).nodes
    ).toMatchObject([
      {
        children: [
          {
            align: "center",
            color: "$color-primary",
            level: 3,
            role: "heading",
            weight: 700,
          },
          { color: "$color-primary", role: "paragraph", text: "Note" },
        ],
      },
    ]);
  });

  it("keeps the words of inline markup in one text, and says its formatting was flattened", () => {
    const { nodes, warnings } = paste(
      "<p>Read the <a href='/docs'>docs</a>,<br> <strong>now</strong>.</p>"
    );
    expect(nodes).toMatchObject([{ text: "Read the docs,\nnow." }]);
    expect(warnings).toEqual([expect.objectContaining({ kind: "inline" })]);
  });

  it("counts the classes of an inline element flattened into a text", () => {
    const { nodes, warnings } = paste(
      `<p>Price <span style="color: #f00" class="md:text-xl foo">$9</span></p>`
    );
    expect(nodes).toMatchObject([{ text: "Price $9" }]);
    expect(Object.fromEntries(warnings.map((w) => [w.kind, w.count]))).toEqual({
      inline: 1,
      unread: 1,
      variant: 1,
    });
  });

  it("leaves out the words of an inline element not shown, or shown to screen readers alone", () => {
    expect(
      paste(
        `<p>Visible <span class="hidden">A</span><span style="display:none">B</span><span class="sr-only">C</span></p>`
      ).nodes
    ).toMatchObject([{ text: "Visible" }]);
  });

  it("keeps an image's address and alt as they are", () => {
    expect(paste(`<img src="/logo.svg" alt="Logo" width="40">`).nodes).toEqual([
      { alt: "Logo", id: "img_1", src: "/logo.svg", type: "image", width: 40 },
    ]);
  });

  it("leaves out an SVG and says so", () => {
    expect(warned("<div><svg></svg><p>x</p></div>")).toEqual({ svg: 1 });
  });

  it("leaves out an image held in the markup and says so", () => {
    expect(
      warned(`<div><img src="data:image/png;base64,AA"><p>x</p></div>`)
    ).toEqual({ dataImage: 1 });
  });

  it("counts a class with a variant as not read", () => {
    expect(warned(`<p class="md:p-4 hover:bg-primary">x</p>`)).toEqual({
      variant: 2,
    });
  });

  it("drops scripts, stylesheets, comments and what is not shown, without a word", () => {
    expect(
      paste(`<style>p { color: red }</style><script>alert(1)</script><!-- note -->
        <p hidden>Gone</p><p class="hidden">Gone</p><p style="display:none">Gone</p><p>Kept</p>`)
    ).toEqual({
      nodes: [{ id: "t_1", role: "paragraph", text: "Kept", type: "text" }],
      warnings: [],
    });
  });

  it("counts the classes it does not read, as a page's stylesheet would have set them", () => {
    expect(
      warned(`<div class="card shadow-glow"><p class="lead">x</p></div>`)
    ).toEqual({
      unread: 3,
    });
  });

  it("warns of a size it cannot hold, a percentage", () => {
    const { nodes, warnings } = paste(`<p style="width: 50%">x</p>`);
    expect(nodes).toEqual([
      { id: "t_1", role: "paragraph", text: "x", type: "text" },
    ]);
    expect(warnings).toEqual([expect.objectContaining({ kind: "size" })]);
  });

  it("pastes nothing from markup in which nothing could be carried, and says why", () => {
    expect(paste("<svg><circle r='4'></circle></svg>")).toEqual({
      nodes: [],
      warnings: [expect.objectContaining({ count: 1, kind: "svg" })],
    });
  });

  it("keeps a button's look and says its behaviour is not carried", () => {
    const { nodes, warnings } = paste(
      `<button class="rounded-lg bg-primary px-4 py-2 text-white">Buy</button>`
    );
    expect(nodes).toMatchObject([
      { fill: "$color-primary", radius: "$radius-lg", text: "Buy" },
    ]);
    expect(warnings).toEqual([expect.objectContaining({ kind: "button" })]);
  });
});

describe("saying what was not carried", () => {
  it("says a kind once, with how often when it was met more than once", () => {
    expect(
      paste(
        `<p class="card">x</p><p class="lead tight">y</p><div class="grid"><p>z</p></div>`
      ).warnings
    ).toEqual([
      { count: 3, kind: "unread", text: "3 classes not read" },
      { count: 1, kind: "grid", text: "a grid laid out as a column" },
    ]);
  });
});

describe("markup a review found the rules misread", () => {
  it("reads a tag named after a property of every object as any unknown element", () => {
    expect(paste("<constructor>x</constructor>").nodes).toMatchObject([
      { text: "x" },
    ]);
  });

  it("drops a hidden SVG or control without a word, even as a flex's item", () => {
    expect(
      warned(
        `<div class="flex"><svg hidden></svg><input class="hidden"><p>x</p></div>`
      )
    ).toEqual({});
  });

  it("pastes nothing from a hidden body, and gives a shown one's text settings to its children", () => {
    expect(paste("<body hidden><p>x</p></body>").nodes).toEqual([]);
    expect(
      paste(`<body style="color: #abcdef"><p>x</p></body>`).nodes
    ).toMatchObject([{ color: "#abcdef" }]);
  });

  it("keeps a line height in pixels as pixels, and a multiple as a number", () => {
    expect(
      paste(
        `<p style="line-height: 24px">a</p><p style="line-height: 1.5">b</p>`
      ).nodes
    ).toMatchObject([{ lineHeight: "24px" }, { lineHeight: 1.5 }]);
  });

  it("lets an inline reset take back what a class set", () => {
    const [text] = paste(
      `<p class="p-4" style="padding-left: initial">x</p>`
    ).nodes;
    expect(text).toMatchObject({
      padding: {
        bottom: "$spacing-4",
        right: "$spacing-4",
        top: "$spacing-4",
      },
    });
    expect((text as { padding: object }).padding).not.toHaveProperty("left");
  });

  it("sets a text setting reset inline back to where it starts, not to what it inherits", () => {
    expect(
      paste(
        `<div class="font-bold"><p style="font-weight: initial">a</p><p style="font-weight: inherit">b</p></div>`
      ).nodes
    ).toMatchObject([{ children: [{ weight: 400 }, { weight: 700 }] }]);
  });

  it("keeps a multiple of the size of 4 or more as a multiple", () => {
    expect(
      paste(`<p style="line-height: 24">a</p><p style="line-height: 2">b</p>`)
        .nodes
    ).toMatchObject([{ lineHeight: "24" }, { lineHeight: 2 }]);
  });

  it("keeps a class's gradient under an inline colour, as the cascade meets them field by field", () => {
    expect(
      paste(
        `<p class="bg-[linear-gradient(90deg,red,blue)]" style="background-color: #abcdef">x</p>`
      ).nodes
    ).toMatchObject([{ fill: "linear-gradient(90deg,red,blue), #abcdef" }]);
  });

  it("keeps an explicit size across a flex row when the child stretches", () => {
    expect(
      paste(
        `<div class="flex"><p class="self-stretch h-[40px]">a</p><p class="self-stretch">b</p></div>`
      ).nodes
    ).toMatchObject([{ children: [{ height: 40 }, { height: "fill" }] }]);
  });

  it("keeps a maximum of 0", () => {
    expect(
      paste(`<p style="max-width: 0px; min-width: 0px">x</p>`).nodes
    ).toEqual([
      { id: "t_1", maxWidth: 0, role: "paragraph", text: "x", type: "text" },
    ]);
  });
});
