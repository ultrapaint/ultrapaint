/**
 * Whether markup on the clipboard is JSX rather than HTML (ADR 0148), so a paste of it makes no
 * layers: its expressions, components and props would need rules of their own. Read off the text,
 * as a parsed document no longer says: a component's tag (`<Button`), a fragment (`<>`), a prop
 * HTML does not have (`className=`, `htmlFor=`), or an expression as a value (`={`). Pure.
 */
const JSX_RE = /<[A-Z][\w.]*[\s/>]|<\/?>|\b(?:className|htmlFor)=|=\{/;

export const isJsx = (text: string): boolean => JSX_RE.test(text);
