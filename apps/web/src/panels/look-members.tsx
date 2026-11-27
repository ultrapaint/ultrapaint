/**
 * A system component's own variant members, edited in its look on the Library's board (ADR 0161):
 * each axis's members in one field, the editor's first and the product's after them, a member
 * left out no longer offered; an axis of the product's own added with its members, the first its
 * default. Appearance only: a member that does more is an app component's (ADR 0041).
 */
import type {
  ComponentChange,
  SystemComponentFile,
} from "@ultrapaint/contracts/components";
import {
  axesOf,
  type SystemComponentMeta,
} from "@ultrapaint/system-components/catalogue";
import { Input } from "@/components/ui/input";
import { changeFile } from "../state/components.ts";
import { blurOnEnter } from "./component-props.tsx";
import { Row } from "./inspector-fields.tsx";

const LIST_RE = /\s*,\s*/;

/** The members a field lists, in its order, each once. */
const listed = (text: string) => [
  ...new Set(
    text
      .trim()
      .split(LIST_RE)
      .filter((m) => m !== "")
  ),
];

/**
 * The changes that make an axis offer `after` instead of `before`: the members added first, so
 * an axis whose members are all replaced keeps one throughout.
 */
const memberChanges = (
  axis: string,
  before: readonly string[],
  after: readonly string[]
): ComponentChange[] => [
  ...after
    .filter((m) => !before.includes(m))
    .map((member) => ({ axis, member, op: "addMember" as const })),
  ...before
    .filter((m) => !after.includes(m))
    .map((member) => ({ axis, member, op: "removeMember" as const })),
];

/**
 * The changes made one at a time, each on the file the one before left, stopping at the first
 * the server refuses (it says why).
 */
const send = async (
  file: SystemComponentFile,
  [change, ...rest]: readonly ComponentChange[]
): Promise<void> => {
  if (change && (await changeFile(file, change))) {
    await send(file, rest);
  }
};

/** An axis of the product's own as typed: `shape: default, pill`. */
const ownAxisOf = (text: string) => {
  const at = text.indexOf(":");
  if (at < 0) {
    return null;
  }
  const axis = text.slice(0, at).trim();
  const members = listed(text.slice(at + 1));
  return axis === "" || members.length === 0 ? null : { axis, members };
};

export const LookMembers = ({
  file,
  meta,
}: {
  file: SystemComponentFile;
  meta: SystemComponentMeta;
}) => {
  const axes = axesOf(meta, file);
  return (
    <>
      {Object.entries(axes).map(([axis, { members }]) => (
        <Row key={axis} label={axis}>
          <Input
            aria-label={`${axis}’s members`}
            defaultValue={members.join(", ")}
            key={members.join(",")}
            onBlur={(e) => {
              const after = listed(e.target.value);
              if (after.length === 0) {
                e.target.value = members.join(", ");
                return;
              }
              send(file, memberChanges(axis, members, after));
            }}
            onKeyDown={blurOnEnter}
          />
        </Row>
      ))}
      <Row label="New axis">
        <Input
          aria-label="New axis"
          onBlur={(e) => {
            const own = ownAxisOf(e.target.value);
            if (!own) {
              return;
            }
            e.target.value = "";
            send(file, memberChanges(own.axis, [], own.members));
          }}
          onKeyDown={blurOnEnter}
          placeholder="shape: default, pill"
        />
      </Row>
      <p className="px-0.5 font-body-small text-muted-foreground">
        Members you add style the look alone. One you take out stays on its
        instances until you move them in Problems.
      </p>
    </>
  );
};
