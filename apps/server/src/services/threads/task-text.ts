/**
 * What every task a slash command expands into is written with: how a command's argument reads,
 * what the user adds after it, and the formats an agent writes without the editor's tools.
 */
import { DesignSystem } from "@ultrapaint/contracts/design-system";
import { PageDocument } from "@ultrapaint/contracts/document";
import { Schema } from "effect";

const WHITESPACE_RE = /\s+/;

/** The design system's schema, for an agent that has to write the file without the tools. */
export const designSystemSchema = () =>
  JSON.stringify(Schema.toJsonSchemaDocument(DesignSystem).schema);

/** The page format's schema, for agents. */
export const pageSchema = () =>
  JSON.stringify(Schema.toJsonSchemaDocument(PageDocument));

/** What the user typed after the command's argument, passed on as it is. */
export const userAdds = (extra: string) =>
  extra ? `\nThe user adds:\n${extra}\n` : "";

/** A command's argument: its first word, and what the user adds after it. */
export const splitArgument = (argument: string) => {
  const [target = "", ...rest] = argument.trim().split(WHITESPACE_RE);
  return { extra: rest.join(" "), target };
};
