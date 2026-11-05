/**
 * The chat composer's look, shared with the start screen's prompt (ADR 0062): a quiet surface
 * that rings when its text has focus, and the text inside it.
 */

/** The box around the prompt and its pickers. */
export const composerBox =
  "flex flex-col rounded-lg border border-transparent bg-muted transition-colors duration-100 hover:border-input has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-2 has-[textarea:focus-visible]:ring-ring/25";

/** The composer's text: the prompt, or an answer of one's own. */
export const composerText =
  "field-sizing-content max-h-60 min-h-16 w-full resize-none bg-transparent px-3 pt-2.5 pb-1 font-body outline-none placeholder:text-muted-foreground";
