# ADR 0064: Files from disk reach the agent as pictures or as text

Status: accepted, 2026-11-06.

## Context

A prompt could carry places in the designs (a node, a page, a board's pick) and pictures pasted
from the clipboard. People also want to give an agent what is on their disk: a screenshot, a
brief, a palette as CSV, brand guidelines as a PDF. The look page's agent box (ADR 0062) was to
take a picture and could not.

Two ways were open for a file that is not a picture: send its contents with the prompt, or upload
it where the agent reads it with its own tools. The agents are reached over ACP. Every agent takes
text; an embedded resource falls back to a link where an agent takes none (`promptBlock`), and a
link needs a file the agent can open. An uploaded file would be written outside the repository
(its designs directory is the design thread's only writable place, and the person's code is not
ours to fill), where a design thread's agent may need a permission to read it, and it would have
to be cleaned up. No agent the editor runs reads a PDF sent as a blob over ACP.

## Decision

1. **Two kinds.** A file from disk is attached as a **picture** (any `image/*`, as a pasted one:
   byte for byte when a model takes it as it is, else drawn smaller as WebP) or as **text**. A
   file is text when its bytes are UTF-8 without a NUL, whatever its name or type says.
2. **Text goes in the prompt's text.** A text attachment (`{ kind: "text", name, text }`) is read
   in the editor and given to the agent as a text block naming the file, which every agent takes.
   Nothing is written to disk.
3. **Anything else is refused** with what to do instead: put it in the project's folder and name
   it in the prompt, where the agent reads it with its own tools; a `.fig` file goes to Import a
   .fig file…; text in another encoding is saved as UTF-8.
4. **Limits.** A text file holds at most 100 KB (`TEXT_ATTACHMENT_LIMIT`, checked again on the
   wire), about 25,000 tokens; a prompt carries at most 200 KB of text and 10 pictures; a picture
   over 50 MB is not read. A file over a limit is refused with its size and the limit.
5. **Ways in.** The composer's + menu has *Add pictures or files…* (the system's picker, several
   at once); files dropped on the composer, or on the look page's agent box, are attached, the box
   ringed and saying *Drop to attach* while they are over it; a layer, a component or text dragged
   over it is left alone. The look page's box takes pictures only, by paste, drop and its picture
   button, and sends them with its prompt.

## Consequences

- A PDF or a document reaches the agent only through the project's folder. If an agent comes to
  take documents over ACP, a third kind can be added beside these two.
- A queued prompt keeps its text attachments whole, as it keeps its pictures.
