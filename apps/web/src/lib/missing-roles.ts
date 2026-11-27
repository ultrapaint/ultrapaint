/**
 * The status roles a placed member draws with that the design system lacks (UP-252, ADR 0162):
 * a `warning` Badge reads `color-warning` and its foreground. It draws in Ultrapaint's default for
 * them meanwhile, and Problems names them, a member at a time, for an agent to add with the
 * product's colours (ADR 0054). Counted where removed members are (`documentsOf`); a project with
 * no design system is drawn in the default look, which has them all.
 */
import {
  type ComponentFile,
  SYSTEM_FROM,
  systemComponentsIn,
} from "@ultrapaint/contracts/components";
import type { DesignSystem } from "@ultrapaint/contracts/design-system";
import type { DesignNode } from "@ultrapaint/contracts/document";
import { DETAILED_ROLES } from "@ultrapaint/contracts/token-presets";
import { allTokens } from "@ultrapaint/contracts/token-table";
import type { ComponentLook } from "@ultrapaint/design-document/component-look";
import { walk } from "@ultrapaint/design-document/tree";
import { defaultLookOf, lookOf } from "@ultrapaint/system-components/defaults";
import { STATUS_COLORS } from "@ultrapaint/system-components/look";
import { documentsOf, type ReadDocument } from "./removed-members.ts";

/** One member placed somewhere that draws with roles the design system lacks. */
export interface MemberLackingRoles {
  readonly axis: string;
  readonly component: string;
  /** How many instances are in it. */
  readonly instances: number;
  readonly member: string;
  /** The documents they are in, by name, in the order first met. */
  readonly places: readonly string[];
  /** The roles it reads that the design system lacks, in the palette's order. */
  readonly roles: readonly string[];
}

/** The status roles, in the palette's order: each fill, then the text on it. */
const STATUS_ROLES = STATUS_COLORS.map((c) => c.name);
/** A colour role a look reads, as `$color-warning`. */
const ROLE_READ = /\$(color-[a-z0-9-]+)/g;

/** A test of whether the design system gives a role a value: its own token, or its detailed one. */
const roleTest = (ds: DesignSystem, names: ReadonlySet<string>) => {
  const detailed = ds.tokenPreset === "detailed";
  return (role: string) => {
    const token = DETAILED_ROLES[role];
    return (
      names.has(role) || (detailed && token !== undefined && names.has(token))
    );
  };
};

/** A member as one instance is in it: what it is, and the status roles it lacks. */
type Lacked = Omit<MemberLackingRoles, "instances" | "places">;

/** Each member an instance is in, by axis, with the status roles its look reads there. */
const lackedIn = (
  node: DesignNode,
  looks: (component: string) => ComponentLook | undefined,
  has: (role: string) => boolean
): Lacked[] => {
  if (!(node.type === "instance" && node.from === SYSTEM_FROM)) {
    return [];
  }
  const look = looks(node.component);
  return Object.entries(look?.variants ?? {}).flatMap(([axis, members]) => {
    const set = node.props?.[axis];
    const member = typeof set === "string" ? set : look?.defaults[axis];
    if (member === undefined) {
      return [];
    }
    const reads = new Set(
      [...JSON.stringify(members[member] ?? {}).matchAll(ROLE_READ)].map(
        ([, role]) => role
      )
    );
    const roles = STATUS_ROLES.filter((role) => reads.has(role) && !has(role));
    return roles.length === 0
      ? []
      : [{ axis, component: node.component, member, roles }];
  });
};

/** Every member placed on the documents read whose status roles the design system lacks. */
export const missingRolesOf = (
  components: readonly ComponentFile[],
  designSystem: DesignSystem | null,
  pages: readonly ReadDocument[]
): MemberLackingRoles[] => {
  if (!designSystem) {
    return [];
  }
  const has = roleTest(
    designSystem,
    new Set(
      allTokens(designSystem)
        .filter((t) => t.value !== "")
        .map((t) => t.name)
    )
  );
  const owned = new Map(systemComponentsIn(components).map((f) => [f.name, f]));
  const looks = (component: string) => {
    const file = owned.get(component) ?? defaultLookOf(component);
    return file && lookOf(file);
  };
  const found = new Map<string, { entry: Lacked; places: string[] }>();
  for (const document of documentsOf(components, pages)) {
    for (const node of document.root ? walk(document.root) : []) {
      for (const entry of lackedIn(node, looks, has)) {
        const key = `${entry.component}.${entry.axis}.${entry.member}`;
        const seen = found.get(key) ?? { entry, places: [] };
        seen.places.push(document.name);
        found.set(key, seen);
      }
    }
  }
  return [...found.values()].map(({ entry, places }) => ({
    ...entry,
    instances: places.length,
    places: [...new Set(places)],
  }));
};
