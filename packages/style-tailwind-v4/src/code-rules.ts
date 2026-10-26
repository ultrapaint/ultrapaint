/**
 * How a page's tokens and nodes become code written with Tailwind v4 and the repository's
 * components, told to every agent that implements a page. The editor's Code tab writes the same
 * translation out (`node-classes.ts`, the classes of `@ultrapaint/design-document/code`'s JSX):
 * change both together.
 */
export const codeRules = `How the design maps to code (Tailwind v4):
- A token "$name" is the theme variable --name. "$color-primary" is bg-primary, text-primary,
  border-primary; "$radius-lg" is rounded-lg; "$shadow-md" is shadow-md; "$text-lg" is text-lg;
  "$font-weight-semibold" is font-semibold; "$font-sans" is font-sans; "$leading-tight" is
  leading-tight; "$tracking-wide" is tracking-wide; "$spacing-4" is the 4 step (p-4, gap-4).
- A number is pixels. Put it on the spacing scale (one step is the design system's spacing base,
  usually 4px: 16 is p-4) and use an arbitrary value only when it is off the scale.
- page: the page component of the URL it serves. row: flex flex-row. column: flex flex-col. group: a plain
  div. gap: gap-*. align start/center/end/between/around: justify-start/center/end/between/around.
  crossAlign: items-*. wrap: flex-wrap. padding: p-*, or px/py/pt/pr/pb/pl for sides. margin: the
  same with m (m-*, mx-*, -mt-*).
- width or height "fill": flex-1 along the parent's direction, self-stretch across it, w-full
  or h-full in a group. "hug": w-fit or h-fit. A number: a fixed size (w-80 or w-[320px]).
  Inside an instance, "the parent" is the element of the component that holds its children:
  read the component to see whether it is a flex row, a flex column or a block.
- fill: bg-*. border: border, border-* and the colour; "$border-width-*" is
  border-(length:--border-width-*). radius: rounded-*. shadow: shadow-*. "$container-md" in
  maxWidth or minWidth is max-w-md or min-w-md.
  opacity: opacity-*. hidden: leave the node out. order: order-* (-order-1 for -1).
- at: what differs from a breakpoint of the design system up, mobile-first: at.md.gap 24 is
  md:gap-6 beside the base's gap-4; at.md.type "row" on a column is max-md:flex-col (or flex-col
  md:flex-row); hidden with at.lg.hidden false is max-lg:hidden. A text or props that differ: the
  component's own responsive prop if it has one, else one element per width with the hidden
  classes. Never a second component for the phone.
- text: role heading with level n is <hN>, paragraph is <p>; size, weight, font, lineHeight,
  tracking, color and align are the matching utilities; textStyle names a text style of the
  design system — write all of the classes that style stands for (its size, weight and line
  height, and its font and tracking when it sets them), then the node's own fields over them.
- instance: the component \`component\` imported from \`from\`, with \`props\` as its props and
  \`text\` or \`children\` as its children. Its size, padding, fill, border, radius and shadow
  are classes in the component's own className, as the canvas draws them; a component that
  does not take a className gets them on a div around it (flex flex-col, then the classes).
- image: <img>; an "assets/..." src is a file of the canvas's own assets/ directory when it has
  one, and of the shared assets/ at the root of the designs directory otherwise — copy it to
  where the application keeps images.
- link: the application's own router link. A page file (pricing.page.json) links to the URL that
  page serves (list_pages says which); a URL links to itself; "back" goes back in the router's
  history; another site is a plain anchor. A link to a page without a URL: ask where it goes.`;
