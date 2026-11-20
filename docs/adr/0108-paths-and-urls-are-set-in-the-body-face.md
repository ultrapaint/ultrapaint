# ADR 0108: Paths, URLs and file names are set in the body face

Status: accepted, 2026-11-20. Amends 0070 (what Geist Mono is for) and 0080 (the path to fix, in
code).

## Context

The editor set every path, URL, route and file name in Geist Mono (`font-code`), as it sets a
token's value or a command: a project's folder under its name, the prototype's address bar, the
Routes list, the folders in Settings, "Fix it in `pages/home.page.json`". The person compared it
with T3 Code, which sets a workspace's folder, a file's path and a project's location in its body
face and keeps mono for code, a commit's hash and a terminal, and asked for the editor to do the
same everywhere. The welcome's project list already did.

## Decision

- **A path, a URL, a route, a host, or a file or folder name is set in Figtree**, never in
  `font-code`, and in a `span`, not a `code`:
  - under a name, as what qualifies it (a project's folder, a skill's file): `font-body-small`
    muted;
  - as a row's own content (a folder in Settings, a picture's path, a migration's folder, a page's
    URL in the inspector): `font-body`, the row's token;
  - in a sentence: the sentence's token, in the foreground when the sentence is muted;
  - in a field: the field's own `font-body`.
- **Geist Mono stays for code**: a command (`node --version`), a token's name and value, a class
  (`max-md:hidden`, an option's description marked `code`), an element's tag, a JSON place, an
  environment variable, a package name, a slash command, a log or terminal's lines, a code block.
- An option's description in `OptionSelect` is `font-body-small` muted, and `font-code` only when
  the option says it is code.

## Consequences

- No new token: the body tokens carry paths as they carry any words, so a row with a path in it
  is as high as one with a name.
- A path no longer stands out by its face. Under a name it stands out by being muted, in a
  sentence by being in the foreground.
- The Routes list, the comments' page groups and Problems' file headings read in the face of the
  names beside them.
