import { assert, describe, it } from "@effect/vitest";
import { partOf, splitFrontMatter, withResult } from "./gap.ts";

const FILE = `---
id: g01
title: An empty section drawn as an empty page
kind: missing
status: open
skill: [references/states.md, references/usability.md]
sections: []
---

**What happened.** The empty group was the heaviest block
of the panel.

**The skill now.** \`states.md\` says nothing of its size.

**Result.**
`;

describe("gap", () => {
  it("reads the front matter's fields, a list in brackets as a list, and keeps the text after it", () => {
    const split = splitFrontMatter(FILE);
    assert.deepStrictEqual(split?.fields, {
      id: "g01",
      kind: "missing",
      sections: [],
      skill: ["references/states.md", "references/usability.md"],
      status: "open",
      title: "An empty section drawn as an empty page",
    });
    assert.isTrue(split?.body.startsWith("\n**What happened.**"));
    assert.isUndefined(splitFrontMatter("**What happened.** no front matter"));
  });

  it("gives a part of the text by its heading, up to the next one", () => {
    const body = splitFrontMatter(FILE)?.body ?? "";
    assert.strictEqual(
      partOf(body, "What happened"),
      "The empty group was the heaviest block\nof the panel."
    );
    assert.strictEqual(partOf(body, "Proposed"), "");
  });

  it("adds a run's line under Result, replaces the line of a run done again, and opens the gap to testing", () => {
    const once = withResult(FILE, "recall-1", "shipped 0/2, fix 2/2");
    assert.include(once, "status: testing");
    assert.isTrue(
      once.endsWith("**Result.**\n\n- `recall-1`: shipped 0/2, fix 2/2\n")
    );
    const twice = withResult(
      withResult(once, "recall-2", "shipped 1/2"),
      "recall-1",
      "shipped 1/2, fix 2/2"
    );
    assert.isTrue(
      twice.endsWith(
        "**Result.**\n\n- `recall-2`: shipped 1/2\n- `recall-1`: shipped 1/2, fix 2/2\n"
      )
    );
    assert.include(
      withResult(FILE.replace("status: open", "status: done"), "r", "x"),
      "status: done"
    );
  });
});
