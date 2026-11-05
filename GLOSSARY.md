# Glossary

The names this repository's modules are given, for the concepts they own. The decisions behind
them are in `docs/adr/`; [ADR 0037](docs/adr/0037-deep-modules.md) says why each concept has one
module, and [ADR 0038](docs/adr/0038-deep-modules-second-review.md) gives the ones it left
half-done theirs, [ADR 0039](docs/adr/0039-deep-modules-third-review.md) the ones a third
review found, and [ADR 0042](docs/adr/0042-deep-modules-fourth-review.md) the ones the system
components left, with [ADR 0043](docs/adr/0043-what-the-agents-read-and-the-follow-ups.md)'s
follow-ups, and [ADR 0046](docs/adr/0046-deep-modules-fifth-review.md) the ones the components
refactor and the board view left.

## Design

- **Design system**: the tokens and typography a canvas is drawn with, kept in
  `design-system.json` (everything but values) and `design.tokens.json` (every token's value)
  (ADRs 0028, 0035); the components' looks are their own files (ADR 0041). Read and written by the server's `design-system-files` codec,
  through one write path that reads the files under the journal; after every write the code
  follows what changed (`tokenChangesBetween` of before and after, with `codeTokens: auto`),
  whoever wrote it. Its **themes** (contracts' `themes`): which is the default, what a token holds
  in a theme (the default's when it says nothing, references followed), how a frame is put in one
  and whether one is dark.
- **Foundations**: the design system's values as the Design system place lists them (ADR 0045):
  Color, Typography, Spacing, Radius, Elevation, Motion and Breakpoints, each shown only when the
  design system has data for it, each opened as its boards. The **Guidelines** are DESIGN.md's
  sections (ADR 0027), listed under them and each opened as a document to read and edit.
  Both are changed through `designSystem.edit`, a list of typed operations (a value in a theme,
  a description, a token added, taken out or moved, a group added or renamed, a text style set
  or taken out) applied by design-document's `applyEdits` in one undo step. This is the one
  operation language for values: Sync gives what it takes as operations too (`editsOf`).
- **Token**: a named value of the design system (`color-primary`, `text-xl`, `radius-md`), of a
  **kind** its name's prefix says. The **token table** (contracts' `token-table`) says which list
  of the design system holds each kind; the **spacing base** is the token named `spacing`. The
  **spacing scale** is the base's multiples: a **step** (`spacing-4`, a class's `p-4`) is 4 × the
  base, which no list holds and only a named spacing (`spacing-gutter`) overrides; the **named
  steps** are the ones a designer is offered. A token's **short name** is its name without its
  kind's prefix (`card` for `color-card`). **The tokens with a value** are the tokens of a kind
  that hold it, by the token value's notion of the same value, in the design's order
  (`tokensByValue`); which of several to take is the caller's (Figma and the usage inventory the
  first, Sync only one). A palette's **shade** is a colour token's step of a ramp, 50 to 950
  (`shadeOf`, beside the ramp's steps).
- **Token naming**: how a token another tool writes (a Figma variable or style, a Design Tokens
  file's token) becomes one of the design's: its **foreign path** (`Color/Text/Primary`,
  `font.size.sm`) and a **value hint** (what the tool says the value is) give its kind and name
  (contracts' `token-naming`). A hint that names a value type decides the kind; for a dimension,
  a number or a text the path's words do. The name is the kind's prefix and the path's words
  without the kind's own (`Corner/sm` is `radius-sm`, `Gap/md` `spacing-gap-md`); a number of a
  length kind is in pixels. A path no word or type places is **left out**, with a note.
- **Token value**: what a token holds, read as a colour, a length, a duration, a number or text
  (contracts' `token-value`), with one notion of the same value, a length in pixels, and the
  code's `var()` and `calc()` worked out.
- **Side**: somewhere else a design system's tokens live: the code, Figma, DESIGN.md (ADRs 0025,
  0027, 0028). Each is compared with the design against its **baseline**, what the two last
  agreed on; the **agreement** rule gives a token's outcome. A baseline moves one way, outside
  the undo history, under the design system's one write path (`moveBaseline`); an edit or an
  undo keeps the file's baselines as they are. The **sync engine** compares any
  side, with what each side is to it in `sync-readings`; a **side adapter** (`sync-sides`) says
  how one side is read, matched and kept. Each side owns what it knows: the **code side**
  (`CodeSide`) the code's tokens, read once for every caller, its stylesheets written all or
  nothing, its agreement and the preview's CSS; `DesignMd` the document, its **mirror** of the
  tokens, its baseline and its lint (a pure `lintDocument`); `FigmaBaseline` Figma's baseline while there is no design
  system. The **target tokens** a side is matched to are the design's, else the code's own. The
  **sync plan** (`sync-plan`) is the steps that bring the design system and the code together;
  its **drift** is the tokens the code's comparison finds new in the code.
- **Node style**: what a node's fields mean, as CSS declarations at the base and at each
  breakpoint, tokens kept by name (design-document's `declarationsOf`). The canvas draws them,
  over what it draws besides (`baseStyle`); a style system's **class writer** writes them as its
  classes, Tailwind's with its `md:` and `max-md:` variants (ADR 0024).
- **Utility vocabulary**: Tailwind's utilities as the class writer and every reader of classes
  in the style adapter speak them (style-tailwind-v4's `utilities`): how a class is written (its
  variants, `!`, sign, utility and value, a colour's opacity, an **arbitrary value** and its
  type), the steps of Tailwind's default scales, and the keywords each utility takes as Tailwind
  compiles them, both ways (`w-full` is `100%`; a gap takes none, `gap-[100%]`). What a class means stays the reader's: a look's field, DESIGN.md's
  token, the usage inventory's kind.
- **Page**: a design document, `.page.json`, of a **canvas** (ADRs 0015, 0019, 0020). A page is
  drawn in a **frame**, and in **views** of other widths beside it (ADR 0036); an edit lands at
  the **breakpoint** of the view it is made in. The breakpoint a frame is at is the one its width
  falls in, a node on the canvas's its own fixed width (the web's `frameBreakpoint`). A page's **family** is its base page with its
  **page variants** (`pricing@bold.page.json`) and **page states**, which are named after it and
  move and go with it (`familyOf`). _Avoid_ "variant" or "state" alone where a component's could
  be meant: a component has **variants** and **interaction states** of its own.
- **Operation**: one change to a document (contracts' `DocOp`, design-document's `applyOps`),
  one undo step per request: insert, remove, move, update, set props, wrap, unwrap, duplicate,
  and **replace**, which puts a node where sibling nodes were (an instance drawn as now, detached
  from its component by `detachedOf`, or made one of nodes by `appComponentFrom`, both keeping
  one list of where a node sits). A **document change** is how the editors are told of one
  (ADR 0044): a **patch** of the nodes it made new or changed since the **version** they have (`from`),
  each with its children by id (`changedNodes`, put into a copy by `withChangedNodes`), or the
  whole document when it cannot be said; a copy at another version reads the document again. The
  editor keeps the nodes that did not change as the objects it had (`shareUnchanged` for a whole
  document), so what is drawn of them is not drawn again. A tree's
  **outline** is it shown some levels down, a node at the last counting its children
  (`outlineOf`): how an agent reads a big page first.
- **Canvas layout**: where frames go on a canvas, with one gap (contracts' `canvas-layout`): a
  new frame past every frame and its views, a copy, variant or state beside its page when nothing
  is there, a page the layout does not place yet where the editor draws it, a new view beside its
  page and the view's name.
- **Snapshot**: a named point in the designs' history (ADR 0019), a ref of the `designs`
  namespace in the tool's **snapshot store**. A **checkpoint**, the designs before an agent's
  turn (ADR 0008), is a ref of its `checkpoints` namespace, the last 30 kept. Both keep every
  design file but the comments, are compared with now and put back one way (`design-refs`: one
  undo step), and keeping a checkpoint as a snapshot names its files again. Whenever one is kept
  or let go of, the server publishes the open repository's list of that kind (`checkpoints`,
  `snapshots`), which the Changes panel follows (`kept`). A checkpoint and a file's diff are
  contracts' `snapshots` (`Checkpoint`, `FileDiff`), the diff worked out by the server's
  `file-diff`.

## Agents

- **Thread**: a conversation with an agent about a scope; a **turn** is one prompt and what the
  agent does with it (`turn`: on its way to the agent, at the agent, or none; the one place a turn
  ends or fails). `ThreadSessions` creates and deletes threads and gives a thread's **session**
  (`ThreadSession`), which holds its live state and status, and switches its agent;
  a thread is **busy** while a turn runs or is being stopped (`isBusy`). How a thread is shown
  (busy, waiting on the user, failed, and the word a list, a dot or a badge says) is the web's
  `threadView`; what a prompt carries for its chips, a comment sent to an agent's included, is
  `attachmentsOf`.
- **A turn's files**: the files the folder's stamps found changed during a turn (ADR 0031), told
  apart by its **witness** (`turn-witness`), which hears who each file was written for
  (`DesignFiles.writes`) and the files the agent's tool calls edit. When nothing else changed files
  meanwhile they are all the agent's (`changedFiles`), its shell's included; when another thread's
  turn overlapped or a file was written for the user or another thread, only those the agent was
  seen writing are, and the rest were **changed during the turn** (`changedDuring`).
- **Card**: what the agent waits on the user for, a permission or a question
  (`PendingCards`, ADR 0022). The editor never answers a permission from memory: "always" is the
  agent's own option.
- **Agent launcher**: the seam an agent is started through: its sandboxed process (ADR 0013),
  or a scripted in-memory agent in tests. It is given a **host** (the cards, the paths, what the
  agent may write) and builds the editor's side of the launch from it, the terminals confined.
  Each adapter keeps the order of the agent's updates itself (acp's `updates`), and a prompt
  returns once its turn's updates are handled.
- **What the agent advertised** (acp's `negotiated`): what an agent said of itself when it
  started, and the decisions taken from it: how a thread is **reopened** (`session/resume` before
  `session/load`, whose replay the adapter drops), what a prompt may carry (a file embedded or
  linked, a picture or a note of it), whether it is offered the editor's MCP server, and how it
  signs in (never by the editor on its own).
- **Built-in agent**: an agent that ships with the tool (Claude Code, Codex), each one
  **descriptor** in acp's `built-in`: how the command launches it through `npx`, the ACP adapter
  the desktop app bundles in its place, its program, how it is asked whether it is signed in and
  what its answer says, a sign-in through its adapter, the variable a key goes in, and its
  variables by where the app found it (ADRs 0004, 0031). Their ids are contracts'
  `BuiltInAgentId`; any other agent is a JSON file of the user's.
- **Task**: what the editor asks an agent to do (implement a page, a setup step, a sync), named
  by a typed **task request**; a **slash command** is a request written as text. A thread's purpose
  (design or implement, which its sandbox follows) is read from the request before its session
  opens (`purposeFor`), and the task's text is written once the session says what the agent
  takes. The agent's own
  slash commands are offered after the editor's (`agentCommands`). What a prompt carries to the
  agent (its text, its attachments as content blocks) is `prompt-content`'s.
- **Design target**: what `/implement` and `handoff` name a design by (the server's
  `design-targets`, by `designTargetNamed` beside `pageNamed`): `component:Button`, or a bare
  component name, is a component's file; anything else is a page by the page rule, a canvas written first
  (`marketing:/pricing`), a node reference's node kept (`/orders#c_8`). A miss says which kind it
  looked for and lists that kind. The other tools name a page by the page half of the rule
  (`pageTargetNamed`), a miss worded the same (`pageMissed`). The link to the code keys it by its **canonical target**, a
  page's id or `component:<Name>`. A design's **behaviour notes** (ADR 0030) are read and added
  through it whichever way they are kept: a page's are comments pinned on it, resolved when done;
  a component's are in its file, deleted when done.
- **Agent ways**: how an agent does what a task or the briefing asks of it, with the editor's MCP
  tools or without them (`agent-ways`), decided per session: the server offers its tools and the
  agent said it takes them (`mcpHttp`). Each capability is worded both ways (ask the user, save
  the design system, mark a design implemented), and the tools by their own names (`tools`, typed
  from the toolkits, none without the server). A text names a tool only through them. What an
  agent reads says each thing once, compactly (ADR 0043): the page model and the component files'
  format are paragraphs of `agent-docs` that the connect-time instructions, the briefing and the
  tasks compose; a component in one line (`componentLine`), a schema compacted (`compactSchema`),
  a tool's schema without JSON Schema's defaults (`leanSchema`), a tree too big to give whole as
  its outline (`treeForAgent`, for `read_page` and `/implement` alike). The design skills go only
  to threads that draw designs (`drawsDesigns`), and to any agent as MCP resources
  (`skill://ultrapaint/<name>`): whole, or, with the setting `skills.briefing: "summaries"`, by
  their titles and summaries with where each is read whole (`SkillsTold`); the slash commands are
  MCP prompts too.
- **Design gap**: what a person found wrong in a design made with the design skill, kept until
  the lab shows a change to the skill catches it (ADR 0059): one file each in `evals/gaps/`, read
  by evals' `gap.ts`, its kind (missing, missed, process) and status (open, testing, done,
  wontfix). `pnpm evals recall` measures a candidate against the shipped skill on the gaps'
  sections and writes its result into each gap.
- **Review loop**: reviewers that look at a design inside its build, look and adjust loop, their
  findings sent back into the designer's thread to fix or decline (ADR 0060). In the lab, a
  round's `--review end|each-section` (evals' `review-loop.ts`, one section reviewed and merged by
  `section-review.ts`); a **panel** (`panel.ts`) is a fixed set of fresh reviewers whose count of
  what they still find scores a finished design. Both review within the designer's request; what
  only a design-system component would fix is a **system note**, set apart from the findings.
- **Council**: the reviewers a design is reviewed by, the person's choice (ADR 0060). It has no
  score of its own: each reviewer scores the design out of 100, overall and per **category** (one
  of the design skill's references), from its own findings, each with a **severity**; a reviewer
  that gave no review has **no score**. A **goal** says when the loop stops: every reviewer
  reaches its target score, or, with none asked, every reviewer gives its **sign-off**; a cap ends
  a loop that isn't converging. Contracts' `review` (`sectionScore`, `pageScore`, `verdictOf`).
- **General check**: a rule written once for every screen that code decides on the document or
  the rendered page, with a threshold (ADR 0061): values **off the system** (design-document's
  `offSystemValues`: spacing off the base's steps, a raw radius, colour or type size where a
  token was due), and the rendered checks of `measure --checks` (evals' `auditInBrowser`).
- **Outline**: a design's sections, words, actions and states in text, written before the first
  node (ADR 0061); in the lab, a gap section's `outline.md`, which `recall --inputs outline`
  reviews instead of its pictures.
- **Findings log**: the council's findings from every project, appended to
  `~/.ultrapaint/findings/<project>.jsonl` when it is turned on (contracts' `LoggedFinding`), each
  with its category, the rule it cites or none, and what the designer did, for triage into design
  gaps.
- **Where** (MCP's lookup): one resolver for what a tool is pointed at, a page, a node on the
  canvas beside the pages, or a node of either, by route, file, node reference or **editor link**
  (`where`).
- **Editor link**: the editor's URL to a page or to a node of it (`…?canvas=redesign&route=/vibe&node=c_1`,
  `page=` for a page without a URL), which the editor copies (`linkToNode`) and opens on it, and
  which agents take wherever a node reference is taken (shared's `parseEditorLink`).
- **Tool kind**: whether an MCP tool reads, edits or takes something away, and whether doing it
  twice is doing it once (`doing`), which sets its hints; the editor is a closed world. A tool
  answered with a picture or a form is a **raw tool** (`rawTool`), decoded and failed the same
  way. A failure is worded for the agent by its kind (a stale hash: read the page again).
- **Setup step**: one of the design system's five set-up steps (ADR 0023), run with its thread
  by `SetupSteps`; how a step moves (started, finished, stopped, resumed) is one pure rule
  (`stepAfter`). The **usage inventory** the first step takes is what the code's classes use, by
  kind (colour, spacing, size, weight, radius, shadow, layer), each value on the system, close to
  it or off it; the style system names whose defaults count as its own (`defaultsOf`).

## Preview

- **Component**: what an instance places (ADR 0041), of two origins, each kept as
  `components/<Name>.component.json` in the designs directory in one envelope (its name, origin,
  description, category and behaviour notes) with a body of its origin's: contracts' `components`.
  The only home of a component's description (ADR 0042). The server's **component-files** codec
  reads, writes and checks a file (names unique among its properties, slots and members) and
  changes it: a **component change** (`ComponentChange`: a property added, set, renamed or taken
  out, a member renamed, a slot added, taken out or made the default, one thing of a system
  component's look — a part's style at a place, an optional part left out, a slot's content, the
  item template — or a note added or taken out) is made by `ComponentService.change` on the file
  as it is in the step, a rename followed into the variants its tree keeps and every instance's
  props (`instanceOps`, of the documents as they are in the step), in one undo step. Every write
  of a component's file reads it inside the step.
- **Catalogue**: what a design can place, the system components then the app components that
  read (system-components' `catalogueOf`, over the component files; ADR 0042): each entry's props,
  variant axes, slots and their layout, and the example a new instance starts with. The server
  gives it to the agents (`ComponentService.catalogue`), the web's components store makes it from
  the files it holds; `metaOf` finds an instance's entry by its name and origin. A prop is a name,
  a type and a default. A component **takes children** when it has a default slot
  (`componentTakesChildren`): a node inserted or dropped into an instance fills that slot. The
  application's file and part names for a component are `applicationFileOf` and
  `applicationNameOf`, which the Code tab and the starter application share.
- **System component**: one of the editor's own components (`packages/system-components`, ADRs
  0040, 0041): Button, Input, Select, Menu, Popover, Tooltip, Dialog, Toast and the rest, on Base
  UI, run by the editor's React. An instance names one with `from: "@ultrapaint/system"`; `from`
  is one of the two origins (`InstanceFrom`), and a page that names anything else does not read. Its
  entry in the catalogue's source (`SYSTEM_COMPONENTS`) says its props, variant axes, parts (`data-slot`, the optional ones a look
  may leave out), slots, **interaction states** (hover, focus, disabled…) and **layer**: in the page's flow (`inline`), anchored above it
  (`anchored`) or over it (`blocking`). Its **look** is its file: style fields per part at its
  base, in each variant, in each state and in a **state in a variant** (`variantStates`, ADR
  0044: an outline button's hover), the more specific winning and disabled over the other
  states, layout per part, content for a slot given nothing, the
  optional parts left out, a Select's or a Menu's item template; without a file, its default look
  (`defaults.ts`, drawn by `look.ts` through `lookCss`). Its behavioural parts are fixed.
- **App component**: one of the project's own components (ADR 0041), built from system
  components and other app components; an instance names one with `from: "#app"`. Its file is a
  **tree**, its **properties** and its **slots**, drawn in an instance's place by
  `expandAppInstance`. Edited **in place** (`isolation.ts`), its tree is a document of its own,
  `component:<Name>`, that the frame's selection and edits go to.
- **Property**: what an instance of an app component sets, by name (its `props`): a text, a
  boolean, an image or a choice of members, with a default, set on the nodes it **targets**, a
  node's own field for its kind or a prop of the instance a node is.
- **Variant**: a member of a system component's axis (`variant`, `size`), or of an app
  component's choice, whose overrides its nodes keep in their `at` under `<property>=<member>`,
  beside the breakpoints', so a change to the component itself lands in every variant. _Avoid_
  for a page's alternate (a **page variant**) and for Tailwind's `md:` (a class's **prefix**).
- **Slot**: a part of a component that holds nodes (a Dialog's `trigger`, `dialog-header`,
  `dialog-content`, `dialog-footer`; an Input's `input-icon`, ADR 0056; a container of an app
  component's tree): an instance's child
  fills the slot it names (`slot`), the rest fill the **default** slot. **Filling slots** is one
  rule for both origins (design-document's `fillSlots`): a child naming a slot the component lacks
  is in the default one, and a slot given nothing holds the component's own **content**. A slot's
  **layout** is how it lays out what it holds, the catalogue's with a look's `direction`, or an
  app component's container turned in a member or at a breakpoint, over it in the instance's
  variant and at the breakpoints that hold where it is drawn (`slotLayoutOf`): what `fill` and `hug` are relative to on the canvas,
  in the Code tab and in the fill warnings. A node inserted or dropped into an instance fills its
  default slot; a component whose slots are all named is filled from the inspector.
- **Element**: a layout, text or image node, what is not a component, which the tools' **Insert**
  menu offers (`ElementId`, `newElement`, `INSERTED_ELEMENTS`); the Library offers the components.
- **Preview**: what draws the editor's frames (preview-core's `Preview`): the frames, a renderer
  mounted through the core's seam `RenderToCanvas` (the React renderer, or the scripted one of the
  tests), the system components. Nothing of the repository's runs in it.
- **The design's look**: the project's components and the stylesheet drawn from them and the
  design system (`designCss`), set once on the preview (`setLook`, which `followLook` keeps
  current) and shared by every frame; a board's own `css` is the only other stylesheet a frame
  draws. _Avoid_ "look" alone where a system component's look (its file) could be meant. A look
  is edited live: the part's style being typed is laid
  over the saved files as a **look draft** (`draftStyle`), drawn by every frame, until it is
  committed as one `setStyle`.
- **Editor frame**: a frame as the editor opens it, with the holder its host goes in and the pool
  that parks it (`editor-frame`).
- **A frame's request**: what a view tells a frame to draw (`RenderRequest`): the tree, the mode,
  the design system, the canvas's defaults, a board's `css` when it has one, and what is said
  in place of a page; the renderer is told it as a **drawing**, with the look's components. `useFrameDrawing` draws it once the frame is open, whenever it changes and in a frame
  opened anew; a page's, for the canvas and the prototype, is `pageRequest`'s: the page at the
  frame's width, a node on the canvas at the size it is held at.
- **A frame's host**: the element a frame's shadow root is on, the page's `<html>`; the editor
  places it, the core writes it (`frame-host`), its one writer. The editor says how the frame is
  **shown** (class, style, title, input, away). An event is **from a frame** when a host the core drew is on its
  path. A frame **runs** while it takes input (the prototype, interact mode): its system components
  behave, kept to the frame; designed, it is inert and its overlays are open where the design says.
- **Page error**: what went wrong drawing a frame's page (preview-core's `PageError`): a part
  threw. The editor frame keeps its latest, whoever listens and on screen or parked, until the
  frame draws again.

## Editor and shell

- **Location**: where the editor is: canvas, page, route, page variant, board view, with the
  URL. A navigation from a board view leaves it as part of arriving (`goTo`, `toPageCanvas`), one
  entry of the history.
- **Frame ref**: what a frame's id names, a page, a view of one, a node on the canvas or a board
  (the web's `frame-ref`), and what each allows: comments, prototype links, the document shown,
  the width its breakpoint is read at.
- **Surface**: the main area, the page canvas or a board view (the web's `surface`, two adapters):
  its frames, which take a selection, its tools, rail and right panel, its background, the
  commands it offers, what a press or a drop on its ground does, and its step back on Escape.
  Both draw the same ground (`CanvasGround`) and frame headers.
- **Page layout**: where the page canvas's frames and views are drawn, a gesture's frame against
  a layout pushed meanwhile, and the saves in flight (the web's `page-layout`).
- **Server data**: what the editor holds of the server's, each **piece** declared by its store
  with `follow` (how it is read, what the store does with it, the events that bring news of it)
  and followed by one module, `server-data`: the events reach it, it is read again at every
  connection open once asked for, the project's first, an answer for a canvas no longer open
  is dropped, and so is an answer older than one taken or than an event that brings the whole
  piece (`whole`: the checkpoints, the snapshots, git's status). A snapshot on screen is the
  other **source** of what it keeps (the pages, the documents, the layouts), whose news waits
  until the editor goes back to now (ADR 0019).
- **Frame gesture**: moving or sizing a page's frame, or sizing a node on the canvas, from the
  press on its name or corner to the release (the web's `frame-gesture`): drawn as it goes, saved
  once when let go (a page's frame rounded to the pixel, a node in one "Resize" edit). A cancelled
  pointer or Escape puts back whatever the pointer is doing, a drag or a group being drawn too, and
  saves nothing.
- **Selection**: the nodes of a page the user picked, which every view of the page shows, by one
  rule and changed by one module (the web's `selection`: `select`, `selectMany`,
  `toggleSelected`, `selectPage`, `selectForMenu`): a Shift-click in another view adds to it. It is in the view it was
  made in, whose breakpoint its fields are shown and edited at; a node of it Shift-clicked or
  right-clicked in another view takes it there. The inspector, the element toolbar, the outlines
  and Layers read the selected nodes as that view draws them, and what several share as one value
  or `MIXED`.
- **Element toolbar**: the selection's design-system controls and its menu, in a bar docked over
  the tools at the bottom centre while something is selected (the web's `ElementToolbar`,
  `GroupToolbar` and `PageToolbar`, drawn through `selection-dock`), the same at every zoom (ADR
  0058). On the canvas the selection keeps only its **tag**: its name, which walks to its parents
  and children, and the agent's ✦ button, never wider than the element.
- **Field**: one of a node's fields that the inspector and the element toolbar both edit (align,
  text style, colour, fill, tint, radius, shadow, gap), declared once in the web's `node-fields`:
  how the nodes selected read as one value, what a node without it is drawn with (a text's
  align is `start`), what setting a value writes (`null` takes it off), its undo label and the
  kind of token it offers. Both surfaces draw it; an edit lands at the view's breakpoint, where
  unset is the value a node is drawn with.
- **Layers' tree**: the Layers panel's rows as data (the web's `layer-tree`): what a filter leaves
  of them, their **folds** (the rows flipped from pages open and layers folded, or folded among
  what a filter finds), the way down to the selection a reveal opens, and where a dragged row
  lands, as a node-actions `Place`; what it lists, an isolated tree, a board's or the pages
  (`layerScope`). The panel draws it and forwards its events.
- **Showing a panel**: one verb a side, which brings a panel put away back and leaves the
  prototype (ADR 0032): `showRightPanel(tab)`, and `showLeftPanel` a tab of the rail's with what
  it is asked to show there, a **request** (a thread and its draft, a file's changes, a node to
  rename in its Layers row) that waits until the panel takes it up (`useRequest`).
- **Mode**: Canvas or Design system (ADR 0053; the web's `useEditorMode`, `showMode`): the page
  canvas, or the design system on boards. It is Design system exactly while a board view is open,
  and the rail shows the mode's places.
- **Place switch**: Canvas · Design system · Prototype at the top centre of the canvas (ADR 0058;
  `components/place-switch.tsx`): the two modes and the prototype workspace in one control.
- **Editor theme**: light, dark or the system's, the person's pick kept in the browser (ADR 0058;
  `state/theme.ts`); the editor's chrome only, never a design's theme.
- **Library**: the components as the rail's **Components** place lists them (ADR 0045, 0053;
  `library` in the code): **App components**, then **System components**. In Canvas mode it is
  the **insert list** (a click inserts into the selection, a drag places anywhere, ↗ opens a
  component's board, + New makes an app component); in Design System mode the same list is the
  navigation, with an **Overview** of every component in its default look. The elements are not in it: the tools'
  **Insert** menu offers them.
- **Board**: a generated document drawn as a frame, by the renderer that draws pages, to show one
  item of the design system or the Library (ADR 0045): a palette's ramps in a theme, a type
  scale, a system component in every variant and state, an app component in one variant. Its
  nodes are named for what they stand for, by one grammar (`boards/pick`), so a click on one
  **picks** it (a token, a group, a text style, a cell, a variant), and the right panel is the
  inspector of what is picked. A pick sent to the chat is a
  **board attachment**: what it is, what it is now and its file, told to the agent in a sentence
  (`boardPickText`), with no tool added.
- **Board view**: the main area in Design System mode, a Foundations or Components item open
  (ADR 0045, 0053): the
  canvas's pan and zoom over that item's boards only, on a tinted dotted background of its own
  and with a camera of its own, no element toolbar, the URL saying the item
  (`?view=system&item=color`, `?view=library&item=Button`). Leaving it goes back to the page and
  its camera as they were. Its boards are laid out in its own state (`showBoards`,
  `setBoardSize`), and it is started explicitly (`startBoardView`): nothing subscribes at
  import.
- **Revealing**: bringing a page's frame or a node into view, the canvas's counterpart of showing
  a panel (the web's `reveal`): the canvas it is on is opened, the prototype left, it is
  selected, and the camera glides to it once its frame is **laid out**, the canvas on screen and
  the frame's box known (a node beside the pages once its document is read), drawn or not. A move
  of the camera meanwhile, another reveal's included, gives it up.
- **Command**: something the editor does, in one list the palette, the shortcut sheet and the
  menus read (ADR 0032), offered as the surface says; a **binding** is a command's chord and the
  scope it works in. Escape is one command, one step back at a time (`stepBack`: a gesture
  cancelled, a tree left, a card dismissed, the surface's own step, the parent selected).
- **Menu action**: what a context-menu item does, a typed value run by `runMenuAction`.
- **Shell bridge**: the desktop shell's capabilities, one table the web's `Platform` is typed
  from (ADR 0031).
- **Notice**: what the desktop app tells the editor it found missing or out of date on this
  machine, shown as a banner over it until dismissed or the editor loads again
  (`Platform.notices`, the desktop's `Notices`): Node.js, and a newer release where the app does
  not update itself (`updates.ts`, ADR 0051).

## Server

- **Composition root**: what the server is made of, each service on the ones below it, in
  `composition.ts`: the foundation, the open project's layer, the threads and the application
  layer. It is built with **adapters**, the seams that have a test's second one: the preview's
  host, the agents' launcher with its sandbox and the designs' changes. `ProjectTest` builds the
  same application in a test, a project open on a fixture; `ProjectRpc` asks it the editor's
  requests through an in-memory client; `callTool` calls an MCP tool's handler in-process.
- **Open project**: the services and scope of the project open now (`OpenProject`: `use`,
  `service`, `scope`), whoever asks for them.
- **Designs' changes**: every change to the designs, whoever made it (the journal, an agent, a
  checkout), sorted once by kind (a page, the canvases, a component, the design system, its
  tokens, the notes, a skill, the link to the code, the comments) and told once per content
  (`DesignFiles`); its adapters are a watch of the designs directory, or what a test reports. The
  wire's `file.changed` is one output of it. A change is told with its **writer** (`Writer`): a
  thread's agent (a file the editor wrote for it, an MCP call it made), the editor's user, or
  nobody known (what the watcher sees).
- **Read under the journal**: what a step writes from a file, it reads inside the step, under the
  journal's lock (`tx.read`, `tx.readDocument` with a file's codec, `updateFile`), so an undo or
  another edit lands before it or after it and no module needs a lock of its own. Each file has
  one codec: `canvas-files`, `comments-file`, `document-file`, `implementation-files`,
  `component-files`, `design-system-files`. The layouts of `canvas.json` read and written last are
  kept by the open project, one per canvas and read-only (`CanvasFiles`).
- **A page's move**: a page renamed, moved to another canvas or taken out takes its followers
  with it in one step (`movePages`): its files, comments, frames, URL, the canvas's home, the
  links to it (in pages and app components' trees) and its link to the code.
- **Settings in force**: the settings the open project runs, which `ProjectManager` alone puts
  in force, whoever asks (a save, a session saved to a file, a file renamed or changed by someone
  else, detection at start): the project is opened, opened again when it runs other settings, or
  left as it is, by one rule. It tells the editor the project's info, the settings in force
  among it, whenever what the info is made of changes. The editor saves through
  `settings-actions`, which reads the project again.
