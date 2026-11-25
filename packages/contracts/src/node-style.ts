/**
 * A node's look as CSS declarations (ADR 0024, amended 2026-10-28): what the format's fields mean,
 * written once by `@ultrapaint/design-document/css`, which the canvas draws and a style system
 * writes in its own classes. Tokens are kept by name, so a style system writes the utility a
 * token stands for (`$color-primary` is Tailwind's `bg-primary`) rather than its value.
 */

/** A value as a page holds it: a number is pixels, `$name` a token, anything else CSS. */
export type DeclaredValue = string | number;

/**
 * CSS declarations, their properties camelCased as the DOM's style has them, in the order the
 * code lists them. A value that is not a length is a string (`"700"`, `"1.5"`), so a number is
 * always pixels.
 */
export type Declarations = Readonly<Record<string, DeclaredValue>>;

/** A node's declarations from a breakpoint up: the base (null) at every width. */
export interface StyleAt {
  readonly breakpoint: string | null;
  readonly declarations: Declarations;
}

/** How a style system writes a node's look as classes (ADR 0024), its design system made once. */
export interface ClassWriter {
  /**
   * The classes of a node whose style is `styles`: the base's first, then each breakpoint's the
   * tree sets anything at, smallest first, mobile-first (ADR 0036). How a breakpoint is written
   * (Tailwind's `md:`, `max-md:`) is the style system's.
   */
  readonly classes: (styles: readonly StyleAt[]) => readonly string[];
}

/** What a style system read off an element's classes, `ClassReader`'s answer. */
export interface ClassReading {
  /**
   * What the classes set, as declarations of the kind a `ClassWriter` takes: a class naming a
   * token of the design system as that token (`bg-primary` is `$color-primary`, `p-4`
   * `$spacing-4`), a default of the style system's own theme as its CSS, an arbitrary value as
   * the CSS it holds. Side by side, never as a shorthand: `p-4` sets each of `paddingTop`,
   * `paddingRight`, `paddingBottom` and `paddingLeft`.
   */
  readonly declarations: Declarations;
  /** The classes it read nothing from: a utility it does not know, a token nobody declares. */
  readonly unread: readonly string[];
  /** The classes that apply only at a breakpoint or in a state (`md:`, `hover:`), left unread. */
  readonly variants: readonly string[];
}

/**
 * How a style system reads an element's classes back into declarations (ADR 0024), the other
 * way of a `ClassWriter`: what the classes of markup pasted on the canvas set. Its design system
 * made once.
 */
export interface ClassReader {
  readonly read: (classes: readonly string[]) => ClassReading;
}
