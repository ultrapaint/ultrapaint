/** The release's notes (ADR 0078), as the release workflow prints them. Run with Node's own runner. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { INSTALL_MARK } from "../packages/contracts/src/release-notes.ts";
import { lineOf, releaseNotes } from "./release-notes.ts";

test("a commit's line is its behaviour up to its first colon, its ADRs left out", () => {
  assert.equal(
    lineOf(
      "feat: the start screen's prompt takes pictures and text files (ADR 0062, ADR 0064): the desktop app keeps it"
    ),
    "The start screen's prompt takes pictures and text files."
  );
  assert.equal(
    lineOf("fix(web): a menu stays where the ⋮ was (ADR 0020)"),
    "A menu stays where the ⋮ was."
  );
  assert.equal(lineOf("docs: the gaps hold ep-1's results"), undefined);
});

test("the notes list what changes the app, features then fixes, and end with the install mark", () => {
  const notes = releaseNotes([
    {
      files: ["apps/web/src/welcome.tsx"],
      subject: "feat: pictures on the start screen",
    },
    {
      files: ["evals/src/fixes.ts"],
      subject: "feat: pnpm evals fixes checks the decks",
    },
    {
      files: ["apps/web/src/x.test.tsx"],
      subject: "fix: a test waits on a signal",
    },
    {
      files: ["apps/desktop/src/main.ts"],
      subject: "fix: the menu stays put (ADR 0020)",
    },
  ]);
  assert.equal(
    notes,
    `## What’s new\n\n- Pictures on the start screen.\n\n## Fixes\n\n- The menu stays put.\n\n${INSTALL_MARK}\n`
  );
});

test("a release that changes nothing of the app has no notes", () => {
  assert.equal(
    releaseNotes([{ files: ["docs/x.md"], subject: "feat: docs" }]),
    `${INSTALL_MARK}\n`
  );
});
