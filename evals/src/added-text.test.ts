import { assert, describe, it } from "@effect/vitest";
import { addedTexts, briefContent, pageTexts } from "./added-text.ts";

const BRIEF = `# Customers

A screen of the customers behind the revenue.

## Content

### Revenue

The customers behind the revenue, the largest first.

- Revenue: $12,400
- Export the customers list as a CSV file
- "Search customers"
| Name | Plan |
Button: "Add customer"

## Notes

- Revenue is in dollars.
`;

describe("added text", () => {
  it("finds every text of a page in document order, with the node around it", () => {
    const page = {
      root: {
        children: [
          { id: "title", text: " Customers " },
          {
            children: [
              { id: "search", props: { placeholder: "Search customers" } },
              { id: "empty", text: "   " },
            ],
            id: "bar",
          },
          { text: "No id of its own" },
        ],
        id: "root",
      },
    };
    assert.deepStrictEqual(pageTexts(page), [
      { node: "title", parent: "root", text: "Customers" },
      { node: "search", parent: "bar", text: "Search customers" },
      { node: "root", parent: "root", text: "No id of its own" },
    ]);
    assert.deepStrictEqual(pageTexts("not a page"), []);
  });

  it("the brief's content is its items, rows and quoted copy, not the brief writer's own words", () => {
    assert.strictEqual(
      briefContent(BRIEF),
      [
        "- Revenue: $12,400",
        "- Export the customers list as a CSV file",
        '- "Search customers"',
        "| Name | Plan |",
        "Add customer",
      ].join("\n")
    );
  });

  it("keeps the texts the brief's content does not hold, each once, with their words", () => {
    const text = (node: string, said: string) => ({
      node,
      parent: "root",
      text: said,
    });
    assert.deepStrictEqual(
      addedTexts(
        [
          text("a", "Revenue"),
          text("b", "Who pays the most"),
          // The brief's words nearly all there: a sentence shortened is still the brief's.
          text("c", "Export customers list as CSV"),
          text("c2", "The customers behind the revenue"),
          text("d", "Add customer"),
          text("e", "Made with care"),
          text("f", "made with care!"),
          text("g", "•"),
          text("h", "Revenue is in dollars"),
        ],
        BRIEF
      ),
      [
        { ...text("b", "Who pays the most"), words: 4 },
        { ...text("e", "Made with care"), words: 3 },
        { ...text("h", "Revenue is in dollars"), words: 4 },
      ]
    );
  });
});
