/** `launch-editor`'s own guess of the editor: the command and its arguments, or `[null]`. */
declare module "launch-editor/guess.js" {
  const guessEditor: (specifiedEditor?: string) => [string | null, ...string[]];
  export default guessEditor;
}
