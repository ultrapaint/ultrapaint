/**
 * The Vibe toolbar over the selection: only what the design system has — a component's own
 * variants, a text's styles, the colour, radius, spacing and shadow tokens of a container — then
 * Add to chat and the element's menu. Every control is a select that shows its value alone; the
 * menu it opens says which prop or token it sets. Design keeps the plain selection and the
 * inspector instead.
 */
import type { JsonValue } from "@ultrapaint/contracts/base";
import type {
  DesignSystem,
  TextStyle,
} from "@ultrapaint/contracts/design-system";
import type {
  DesignNode,
  InstanceNode,
  TextNode,
} from "@ultrapaint/contracts/document";
import type { Thread } from "@ultrapaint/contracts/threads";
import {
  attachTextStyle,
  groupTextStyles,
} from "@ultrapaint/design-document/text-styles";
import { tokenRef, toPixels } from "@ultrapaint/design-document/tokens";
import { nodeLabel } from "@ultrapaint/design-document/tree";
import { cn } from "cn";
import {
  ALargeSmall,
  BetweenHorizontalStart,
  ChevronDown,
  Copy,
  Ellipsis,
  Group,
  type LucideIcon,
  MessageSquareText,
  MessageSquareX,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquareDashed,
  SquareRoundCorner,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
} from "lucide-react";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AgentIcon } from "../components/agent-icon.tsx";
import { addToChat, removeFromChat } from "../lib/add-to-chat.ts";
import { isAttached } from "../lib/chat-link.ts";
import {
  type Control,
  controlsOf,
  propValue,
  type TokenField,
  tokenLabel,
} from "../lib/element-controls.ts";
import {
  areSiblings,
  setPropsOfNodes,
  updateNodes,
  wrapNodes,
} from "../lib/node-actions.ts";
import { openChat, stopThread } from "../lib/thread-actions.ts";
import { ComponentProps } from "../panels/component-props.tsx";
import { useAgents } from "../state/agents.ts";
import { useAttachments } from "../state/attachments.ts";
import { componentMetaOf, useCatalogue } from "../state/catalogue.ts";
import { showMenu } from "../state/context-menu.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { type Selection, useEditor } from "../state/editor.ts";
import { previewUrl, useProject } from "../state/project.ts";
import { useDrag } from "./drag.ts";
import { LinkControl } from "./link-control.tsx";
import { useChatLink } from "./selection-tag.tsx";
import { SpacingSelect } from "./spacing-select.tsx";
import { drawSpecimen } from "./specimens.ts";
import { Targets, useTargetNodes } from "./toolbar-targets.ts";

const COLOR_PREFIX_RE = /^color-/;
const NO_STYLES: readonly TextStyle[] = [];

/** One value when every node has it, `mixed` when they differ. */
const MIXED = "mixed";
const shared = (values: readonly string[], fallback: string) => {
  const [first = fallback] = values;
  return values.every((v) => v === first) ? first : MIXED;
};

/** Steps of the spacing scale the toolbar offers; the inspector has every value. */
const SPACING_STEPS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12];

const FIELD: Record<
  TokenField,
  { icon: LucideIcon; name: string; utility: string }
> = {
  color: { icon: ALargeSmall, name: "color", utility: "text" },
  fill: { icon: SquareDashed, name: "fill", utility: "bg" },
  gap: { icon: BetweenHorizontalStart, name: "gap", utility: "gap" },
  radius: { icon: SquareRoundCorner, name: "radius", utility: "rounded" },
  shadow: { icon: Copy, name: "shadow", utility: "shadow" },
};

const spacingBaseOf = (ds: DesignSystem | null) =>
  toPixels(ds?.spacing.base ?? "0.25rem") ?? 4;

const colorTokens = (ds: DesignSystem | null) =>
  (ds?.colors ?? []).map((group) => ({
    name: group.name,
    tokens: group.tokens.map((t) => ({
      label: t.name.replace(COLOR_PREFIX_RE, ""),
      swatch: t.value,
      value: tokenRef(t.name),
    })),
  }));

/** The trigger of every select: an icon or a swatch, the value, a chevron. */
const ValueTrigger = ({
  children,
  icon: Icon,
  swatch,
  tooltip,
}: {
  children: ReactNode;
  icon?: LucideIcon;
  swatch?: string | undefined;
  tooltip: string;
}) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <DropdownMenuTrigger
          render={
            <button
              className="flex h-7 max-w-40 items-center gap-1.5 rounded-md px-2 text-[12px] outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 data-popup-open:bg-muted"
              type="button"
            />
          }
        />
      }
    >
      {Icon ? (
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      ) : null}
      {swatch === undefined ? null : (
        <span
          className="size-3 shrink-0 rounded-full border border-foreground/20"
          style={{ background: swatch }}
        />
      )}
      <span className="truncate font-medium">{children}</span>
      <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
    </TooltipTrigger>
    <TooltipContent>{tooltip}</TooltipContent>
  </Tooltip>
);

const MenuHead = ({ name, source }: { name: string; source?: string }) => (
  <DropdownMenuLabel className="flex items-center gap-2">
    <span className="flex-1">{name}</span>
    {source ? (
      <span className="font-mono font-normal text-[10px] text-muted-foreground/70">
        {source}
      </span>
    ) : null}
  </DropdownMenuLabel>
);

/** Pictures of an instance drawn in each value of one of its props, kept for the session. */
const previewCache = new Map<string, string | null>();

/**
 * The pictures of an instance in each value of one of its props, drawn while its menu is open.
 * They are held in state as well as in the cache: what a render reads has to be what changes, or
 * the compiler keeps the first answer.
 */
const useVariantPreviews = (
  node: InstanceNode,
  name: string,
  options: readonly string[],
  open: boolean
) => {
  const ds = useDesignSystem((s) => s.designSystem);
  const host = useProject((s) => previewUrl(s.info.host));
  const canvas = useEditor((s) => s.canvas) ?? "";
  const [pictures, setPictures] = useState<Record<string, string | null>>({});
  const optionsKey = options.join("|");
  useEffect(() => {
    if (!(open && host)) {
      return;
    }
    let live = true;
    const keyOf = (option: string) =>
      JSON.stringify([
        node.component,
        node.from,
        node.props,
        node.text,
        name,
        option,
      ]);
    (async () => {
      for (const option of optionsKey.split("|")) {
        const key = keyOf(option);
        if (!previewCache.has(key)) {
          const root: InstanceNode = {
            ...node,
            props: { ...node.props, [name]: option },
          };
          // Cropped to the instance: what wraps it may take the whole preview. One at a time,
          // as the frame that draws them draws one thing.
          // biome-ignore lint/performance/noAwaitInLoops: the pictures are drawn one after the other.
          const picture = await drawSpecimen(host, root, ds, {
            canvas,
            nodeId: root.id,
          });
          previewCache.set(key, picture);
        }
        if (live) {
          const picture = previewCache.get(key) ?? null;
          setPictures((p) => ({ ...p, [option]: picture }));
        }
      }
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open, host, ds, canvas, optionsKey, node, name]);
  return (option: string) => pictures[option] ?? null;
};

const PropSelect = ({
  control,
  node,
  source,
}: {
  control: Extract<Control, { kind: "prop" }>;
  node: InstanceNode;
  source: string;
}) => {
  const targets = useContext(Targets);
  const [open, setOpen] = useState(false);
  const nodes = useTargetNodes();
  const value = shared(
    nodes.map((n) =>
      n.type === "instance"
        ? propValue(n.props, control.name, control.options)
        : ""
    ),
    propValue(node.props, control.name, control.options)
  );
  const previewOf = useVariantPreviews(
    node,
    control.name,
    control.options,
    open
  );
  const onValue = (v: unknown) =>
    setPropsOfNodes(targets, { [control.name]: String(v) });
  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <ValueTrigger tooltip={control.name}>{value}</ValueTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuGroup>
          <MenuHead name={control.name} source={source} />
          <DropdownMenuRadioGroup onValueChange={onValue} value={value}>
            {control.options.map((option) => {
              const picture = previewOf(option);
              return (
                <DropdownMenuRadioItem key={option} value={option}>
                  <span className="flex h-8 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-white">
                    {picture ? (
                      <img
                        alt=""
                        className="max-h-full max-w-full object-contain"
                        height={32}
                        src={picture}
                        width={80}
                      />
                    ) : null}
                  </span>
                  {option}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const TextStyleSelect = ({ node }: { node: TextNode }) => {
  const targets = useContext(Targets);
  const styles =
    useDesignSystem((s) => s.designSystem?.typography.styles) ?? NO_STYLES;
  const style = styles.find((s) => s.name === node.textStyle);
  const mixedStyles =
    shared(
      useTargetNodes().map((n) =>
        n.type === "text" ? (n.textStyle ?? "") : ""
      ),
      ""
    ) === MIXED;
  const onValue = (v: unknown) => {
    const next = styles.find((s) => s.name === v);
    if (next) {
      updateNodes(
        targets,
        attachTextStyle(next),
        `Set the text in ${next.name}`
      );
    }
  };
  return (
    <DropdownMenu>
      <ValueTrigger icon={ALargeSmall} tooltip="Text style">
        {mixedStyles ? MIXED : (style?.name ?? node.textStyle ?? "No style")}
      </ValueTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuGroup>
          <MenuHead name="Text style" source="text styles" />
          {styles.length === 0 ? (
            <DropdownMenuLabel className="font-normal">
              The design system has no text styles yet.
            </DropdownMenuLabel>
          ) : null}
          <DropdownMenuRadioGroup
            onValueChange={onValue}
            value={node.textStyle ?? ""}
          >
            {[...groupTextStyles(styles)].map(([group, list]) => (
              <DropdownMenuGroup key={group}>
                {list.map((s) => (
                  <DropdownMenuRadioItem key={s.name} value={s.name}>
                    <span
                      className="truncate"
                      style={{
                        fontSize:
                          typeof s.size === "number"
                            ? Math.min(s.size, 22)
                            : undefined,
                        fontWeight:
                          typeof s.weight === "number" ? s.weight : undefined,
                      }}
                    >
                      {s.name}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuGroup>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const ALIGNS: readonly [string, LucideIcon, string][] = [
  ["start", TextAlignStart, "Left"],
  ["center", TextAlignCenter, "Centre"],
  ["end", TextAlignEnd, "Right"],
];

const AlignSelect = ({ node }: { node: TextNode }) => {
  const targets = useContext(Targets);
  const value = shared(
    useTargetNodes().map((n) =>
      n.type === "text" ? (n.align ?? "start") : "start"
    ),
    node.align ?? "start"
  );
  const found = ALIGNS.find(([v]) => v === value);
  const icon = found?.[1] ?? TextAlignStart;
  const label = found?.[2] ?? MIXED;
  return (
    <DropdownMenu>
      <ValueTrigger icon={icon} tooltip="Alignment">
        {label}
      </ValueTrigger>
      <DropdownMenuContent className="w-40">
        <DropdownMenuGroup>
          <MenuHead name="align" />
          <DropdownMenuRadioGroup
            onValueChange={(v) =>
              updateNodes(
                targets,
                { align: v === "start" ? null : String(v) },
                "Align the text"
              )
            }
            value={value}
          >
            {ALIGNS.map(([v, Icon, l]) => (
              <DropdownMenuRadioItem key={v} value={v}>
                <Icon />
                {l}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const TokenSelect = ({
  control,
  node,
}: {
  control: Extract<Control, { kind: "token" }>;
  node: DesignNode;
}) => {
  const targets = useContext(Targets);
  const ds = useDesignSystem((s) => s.designSystem);
  const base = spacingBaseOf(ds);
  const field = FIELD[control.field];
  const raw = (node as unknown as Record<string, JsonValue | undefined>)[
    control.field
  ];
  const label = shared(
    useTargetNodes().map((n) =>
      tokenLabel(
        control.field,
        (n as unknown as Record<string, JsonValue | undefined>)[control.field],
        base
      )
    ),
    tokenLabel(control.field, raw, base)
  );
  const set = (value: JsonValue) =>
    updateNodes(
      targets,
      { [control.field]: value },
      `Change the ${field.name}`
    );
  const colors = control.token === "color" ? colorTokens(ds) : [];
  const swatch =
    control.token === "color"
      ? (colors.flatMap((g) => g.tokens).find((t) => t.value === raw)?.swatch ??
        (typeof raw === "string" ? raw : "transparent"))
      : undefined;
  const current = raw === undefined || raw === null ? "" : String(raw);

  let items: ReactNode;
  if (control.token === "color") {
    items = colors.map((group) => (
      <DropdownMenuGroup key={group.name}>
        <DropdownMenuLabel className="font-normal text-[10.5px]">
          {group.name}
        </DropdownMenuLabel>
        {group.tokens.map((t) => (
          <DropdownMenuRadioItem key={t.value} value={t.value}>
            <span
              className="size-3.5 shrink-0 rounded-full border border-foreground/20"
              style={{ background: t.swatch }}
            />
            <span className="flex-1 truncate">{t.label}</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {field.utility}-{t.label}
            </span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuGroup>
    ));
  } else if (control.token === "spacing") {
    items = SPACING_STEPS.map((step) => (
      <DropdownMenuRadioItem key={step} value={String(step * base)}>
        <span
          className="h-2.5 shrink-0 rounded-sm bg-muted-foreground/40"
          style={{ width: Math.max(2, step * 3) }}
        />
        <span className="flex-1 font-mono">
          {field.utility}-{step}
        </span>
        <span className="text-[10.5px] text-muted-foreground">
          {step * base}px
        </span>
      </DropdownMenuRadioItem>
    ));
  } else {
    const tokens =
      control.token === "radius" ? (ds?.radius ?? []) : (ds?.shadows ?? []);
    const prefix = control.token === "radius" ? "radius-" : "shadow-";
    items = tokens.map((t) => {
      const short = t.name.replace(prefix, "");
      return (
        <DropdownMenuRadioItem key={t.name} value={tokenRef(t.name)}>
          <span className="flex-1 font-mono">
            {field.utility}-{short}
          </span>
          <span className="max-w-24 truncate text-[10.5px] text-muted-foreground">
            {t.value}
          </span>
        </DropdownMenuRadioItem>
      );
    });
  }

  return (
    <DropdownMenu>
      <ValueTrigger
        icon={control.token === "color" ? undefined : field.icon}
        swatch={swatch}
        tooltip={field.name}
      >
        {label}
      </ValueTrigger>
      <DropdownMenuContent className="max-h-80 w-60">
        <DropdownMenuGroup>
          <MenuHead
            name={field.name}
            source={
              control.token === "color" ? "--color-*" : `--${control.token}`
            }
          />
          <DropdownMenuRadioGroup
            onValueChange={(v) => {
              const text = String(v);
              if (text === "") {
                set(null);
              } else {
                set(control.token === "spacing" ? Number(text) : text);
              }
            }}
            value={current}
          >
            <DropdownMenuRadioItem value="">
              <span className="flex-1 text-muted-foreground">none</span>
            </DropdownMenuRadioItem>
            {items}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** The props the toolbar leaves out, all of them, as the inspector shows them. */
const MoreProps = ({ count, node }: { count: number; node: InstanceNode }) => {
  const targets = useContext(Targets);
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  className="flex h-7 items-center gap-1 rounded-md bg-muted px-2 font-medium text-[12px] outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                  type="button"
                />
              }
            />
          }
        >
          <SlidersHorizontal className="size-3.5" />+{count}
        </TooltipTrigger>
        <TooltipContent>Every prop</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-72 gap-0 p-0">
        <ComponentProps
          node={node}
          onSet={(name, value) => setPropsOfNodes(targets, { [name]: value })}
        />
      </PopoverContent>
    </Popover>
  );
};

const Divider = () => <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />;

/** ⌘ on a Mac, Ctrl elsewhere: the key that sends an element to a new chat. */
const withMod = (e: { ctrlKey: boolean; metaKey: boolean }) =>
  e.metaKey || e.ctrlKey;

/**
 * Whether the pointer is over an agent button, and whether ⌘ is held while it is: the moment the
 * button offers a new chat. The pointer says which keys were down when it arrived; the keyboard
 * follows them while it stays.
 */
const useNewChatHover = () => {
  const [hovered, setHovered] = useState(false);
  const [mod, setMod] = useState(false);
  useEffect(() => {
    if (!hovered) {
      return;
    }
    const onKey = (e: KeyboardEvent) => setMod(withMod(e));
    // A key released while the window is in the background never reaches keyup.
    const blur = () => setMod(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", blur);
    };
  }, [hovered]);
  const onPointer = (e: ReactPointerEvent) => {
    setHovered(true);
    setMod(withMod(e));
  };
  return {
    handlers: {
      onPointerEnter: onPointer,
      onPointerLeave: () => setHovered(false),
      onPointerMove: onPointer,
    },
    hovered,
    newChat: hovered && mod,
  };
};

/** The plus on an agent button while ⌘ is held, in its corner so the toolbar keeps its width. */
const NewChatBadge = () => (
  <span className="absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-agent text-agent-foreground ring-2 ring-popover">
    <Plus className="size-2.5" strokeWidth={3} />
  </span>
);

/** What a click on an agent button does, which is also how the button looks. */
type ChatAction = "add" | "new" | "open" | "remove";

const chatAction = (
  newChat: boolean,
  attached: boolean,
  started: boolean
): ChatAction => {
  if (newChat) {
    return "new";
  }
  if (attached) {
    return "remove";
  }
  return started ? "open" : "add";
};

const AGENT_BUTTON =
  "relative flex h-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50";

/**
 * Solid to add, to the open thread or a new one; outlined when attached to the open thread, which a
 * click undoes; tinted when a thread was started on it, which a click opens.
 */
const LOOK: Record<ChatAction, string> = {
  add: "bg-agent text-agent-foreground hover:bg-agent/85",
  new: "bg-agent text-agent-foreground hover:bg-agent/85",
  open: "bg-agent/10 text-agent hover:bg-agent/20",
  remove: "border border-agent bg-agent/15 text-agent hover:bg-agent/25",
};

/** The icon says what a click does: the cross only once the pointer is on a button that removes. */
const ChatIcon = ({
  action,
  hovered,
}: {
  action: ChatAction;
  hovered: boolean;
}) => {
  if (action === "remove" && hovered) {
    return <MessageSquareX className="size-3.5" />;
  }
  if (action === "remove" || action === "open") {
    return <MessageSquareText className="size-3.5" />;
  }
  return <Sparkles className="size-3.5" />;
};

/**
 * Add to chat, in the agents' colour. Once attached to the open thread, a click takes the element
 * back out; once a thread was started on it, a click opens that thread. With ⌘ held it goes to a
 * new thread, whatever it is in already.
 */
const ChatButton = ({ selection }: { selection: Selection }) => {
  const link = useChatLink();
  const { handlers, hovered, newChat } = useNewChatHover();
  const action = chatAction(newChat, link?.attached ?? false, link !== null);
  const onClick = (e: ReactMouseEvent) => {
    if (withMod(e)) {
      addToChat(selection, { newThread: true });
    } else if (link?.attached) {
      removeFromChat(selection);
    } else if (link) {
      useEditor.getState().setLeftTab("chat");
      useAgents.getState().open(link.thread.id);
    } else {
      addToChat(selection);
    }
  };
  const title = link?.thread.title ?? "";
  const label = {
    add: "Add to chat",
    new: "Add to a new chat",
    open: `Open “${title}”`,
    remove: `Remove from “${title}”`,
  }[action];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={label}
            className={cn(AGENT_BUTTON, "w-7", LOOK[action])}
            onClick={onClick}
            type="button"
            {...handlers}
          />
        }
      >
        <ChatIcon action={action} hovered={hovered} />
        {action === "new" ? <NewChatBadge /> : null}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};

/**
 * All the selected elements to the chat, or back out of it once every one is attached to the
 * open thread; with ⌘ held, all of them to a new thread.
 */
const GroupChatButton = ({ targets }: { targets: readonly Selection[] }) => {
  const current = useAgents((s) => s.current);
  const allAttached = useAttachments((s) =>
    targets.every((t) => isAttached(s.byThread, current, t))
  );
  const { handlers, hovered, newChat } = useNewChatHover();
  const action = chatAction(newChat, allAttached, false);
  const onClick = (e: ReactMouseEvent) => {
    if (withMod(e)) {
      addToChat(targets, { newThread: true });
    } else if (allAttached) {
      removeFromChat(targets);
    } else {
      addToChat(targets);
    }
  };
  const count = targets.length;
  const label = {
    add: `Add ${count} to chat`,
    new: `Add ${count} to a new chat`,
    open: `Add ${count} to chat`,
    remove: `Remove ${count} from chat`,
  }[action];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={label}
            className={cn(
              AGENT_BUTTON,
              "gap-1.5 px-2 font-medium text-[12px]",
              LOOK[action]
            )}
            onClick={onClick}
            type="button"
            {...handlers}
          />
        }
      >
        <ChatIcon action={action} hovered={hovered} />
        {count}
        {action === "new" ? <NewChatBadge /> : null}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};

const Controls = ({ node }: { node: DesignNode }) => {
  const meta = useCatalogue((s) =>
    node.type === "instance" ? componentMetaOf(s.catalogue, node) : undefined
  );
  const { more, shown } = controlsOf(node, meta?.variants);
  const source = meta?.file.split("/").at(-1) ?? "props";
  return (
    <>
      {shown.map((control) => {
        switch (control.kind) {
          case "prop":
            return node.type === "instance" ? (
              <PropSelect
                control={control}
                key={control.name}
                node={node}
                source={source}
              />
            ) : null;
          case "textStyle":
            return node.type === "text" ? (
              <TextStyleSelect key="style" node={node} />
            ) : null;
          case "align":
            return node.type === "text" ? (
              <AlignSelect key="align" node={node} />
            ) : null;
          case "spacing":
            return <SpacingSelect key="spacing" />;
          default:
            return (
              <TokenSelect control={control} key={control.field} node={node} />
            );
        }
      })}
      {node.type === "instance" && more.length > 0 ? (
        <MoreProps count={more.length} node={node} />
      ) : null}
      <LinkControl node={node} />
    </>
  );
};

/** The thread whose agent is changing this node right now, if one is. */
const useWorkOn = (selection: Selection | null) =>
  useAgents((s) => {
    if (!selection) {
      return null;
    }
    const entry = Object.entries(s.working).find(
      ([, w]) => !w.done && w.nodeIds.includes(selection.nodeId)
    );
    return entry ? (s.threads.find((t) => t.id === entry[0]) ?? null) : null;
  });

/** While an agent changes the element: who, the way to its thread, and the way to stop it. */
const AgentAtWork = ({ thread }: { thread: Thread }) => {
  const agent = useAgents((s) => s.agents.find((a) => a.id === thread.agentId));
  return (
    <>
      <span className="flex h-7 items-center gap-1.5 px-2 text-[12px]">
        <AgentIcon agentId={thread.agentId} className="size-3.5" />
        {agent?.name ?? "An agent"} is changing this
        <Spinner className="size-3 text-agent" />
      </span>
      <Divider />
      <button
        className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => openChat(thread.id)}
        type="button"
      >
        <MessageSquareText className="size-3.5" />
        Open chat
      </button>
      <button
        className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => stopThread(thread.id)}
        type="button"
      >
        <Square className="size-3" />
        Stop
      </button>
    </>
  );
};

/** Height of the selection's tag, which the toolbar sits above. */
export const TAG_HEIGHT = 20;
/** The toolbar's own height and the room it keeps from what it hangs from, on screen. */
const TOOLBAR_HEIGHT = 34;
const GAP = 8;

/**
 * The frame clips what is drawn outside it: close to its top, the toolbar hangs under the element
 * instead of over it.
 */
export const roomAbove = (rectY: number, inv: number) =>
  rectY >= (TAG_HEIGHT + GAP + TOOLBAR_HEIGHT) * inv;

interface Box {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Where the toolbar goes: centred over the element, or under it when the frame's top would clip
 * it, and moved sideways to stay inside the frame, which clips what is drawn outside it. The
 * toolbar's width is only known once it is drawn; until then it is centred.
 */
const usePlacement = (rect: Box, inv: number, frameWidth: number) => {
  // A callback ref: the toolbar can be drawn later than the hook first runs.
  const [el, placeAt] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!el) {
      return;
    }
    const measure = () => setWidth(el.offsetWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  const above = roomAbove(rect.y, inv);
  const vertical: CSSProperties = above
    ? { bottom: `calc(100% + ${(TAG_HEIGHT + GAP) * inv}px)` }
    : { top: `calc(100% + ${GAP * inv}px)` };
  if (width === null) {
    return [
      placeAt,
      {
        ...vertical,
        left: "50%",
        transform: `scale(${inv}) translateX(-50%)`,
        transformOrigin: above ? "bottom left" : "top left",
      } satisfies CSSProperties,
    ] as const;
  }
  const drawn = width * inv;
  const centred = rect.x + rect.width / 2 - drawn / 2;
  const left = Math.max(0, Math.min(centred, frameWidth - drawn));
  return [
    placeAt,
    {
      ...vertical,
      left: left - rect.x,
      transform: `scale(${inv})`,
      transformOrigin: above ? "bottom left" : "top left",
    } satisfies CSSProperties,
  ] as const;
};

export const ElementToolbar = ({
  frameWidth,
  inv,
  node,
  rect,
}: {
  /** How wide the frame is, which clips what is drawn outside it. */
  frameWidth: number;
  inv: number;
  node: DesignNode;
  /** Where the element is in the frame, which decides where the toolbar can go. */
  rect: Box;
}) => {
  const [placeAt, placement] = usePlacement(rect, inv, frameWidth);
  const selection = useEditor((s) => s.selection);
  const dragging = useDrag((s) => s.dragged !== null);
  const workedOnBy = useWorkOn(selection);
  if (!selection || dragging) {
    return null;
  }
  return (
    <div
      aria-label={`Toolbar of ${nodeLabel(node)}`}
      className="pointer-events-auto absolute left-1/2 flex items-center gap-0.5 whitespace-nowrap rounded-[10px] border bg-popover p-0.5 text-popover-foreground shadow-lg"
      data-element-toolbar
      onPointerDown={(e) => e.stopPropagation()}
      ref={placeAt}
      role="toolbar"
      style={placement}
    >
      {workedOnBy ? (
        <AgentAtWork thread={workedOnBy} />
      ) : (
        <Targets.Provider value={[selection]}>
          <Controls node={node} />
          <Divider />
          <ChatButton selection={selection} />
        </Targets.Provider>
      )}
      <MoreButton target={selection} />
    </div>
  );
};

/**
 * The node's context menu, under the button. Opened on a node of the selection, it acts on the
 * whole selection, as a right-click on it does.
 */
const MoreButton = ({ target }: { target: Selection }) => {
  const openMore = (e: ReactMouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(
      { frame: target.frame, kind: "node", nodeId: target.nodeId },
      { x: r.left, y: r.bottom + 4 }
    );
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label="More"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={openMore}
            type="button"
          />
        }
      >
        <Ellipsis className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>More</TooltipContent>
    </Tooltip>
  );
};

/** Whether nodes are of one kind, so the controls of one of them fit all: one component, or one type. */
const sameKind = (nodes: readonly DesignNode[]) => {
  const [first] = nodes;
  return nodes.every((n) =>
    n.type === "instance" && first?.type === "instance"
      ? n.component === first.component && n.from === first.from
      : n.type === first?.type
  );
};

const WRAPS = [
  ["row", "Row"],
  ["column", "Column"],
  ["group", "Group"],
] as const;

/**
 * The toolbar over several selected elements: what they share when they are of one kind, set on
 * all of them at once; wrapping siblings in a row, a column or a group; all of them to the chat.
 */
export const GroupToolbar = ({
  frameWidth,
  inv,
  nodes,
  rect,
  targets,
}: {
  frameWidth: number;
  inv: number;
  nodes: readonly DesignNode[];
  rect: Box;
  targets: readonly Selection[];
}) => {
  const [placeAt, placement] = usePlacement(rect, inv, frameWidth);
  const dragging = useDrag((s) => s.dragged !== null);
  const [first] = nodes;
  if (dragging || !first) {
    return null;
  }
  const siblings = areSiblings(targets);
  return (
    <div
      aria-label={`Toolbar of ${nodes.length} elements`}
      className="pointer-events-auto absolute left-1/2 flex items-center gap-0.5 whitespace-nowrap rounded-[10px] border bg-popover p-0.5 text-popover-foreground shadow-lg"
      data-element-toolbar
      onPointerDown={(e) => e.stopPropagation()}
      ref={placeAt}
      role="toolbar"
      style={placement}
    >
      <Targets.Provider value={targets}>
        {sameKind(nodes) ? (
          <>
            <Controls node={first} />
            <Divider />
          </>
        ) : null}
        <DropdownMenu>
          <ValueTrigger
            icon={Group}
            tooltip={
              siblings
                ? "Wrap them in"
                : "Only siblings can be wrapped together"
            }
          >
            Wrap in
          </ValueTrigger>
          <DropdownMenuContent className="w-40">
            <DropdownMenuGroup>
              <MenuHead name="wrap in" />
              {WRAPS.map(([type, label]) => (
                <DropdownMenuItem
                  disabled={!siblings}
                  key={type}
                  onClick={() => wrapNodes(targets, type)}
                >
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Divider />
        <GroupChatButton targets={targets} />
        {targets[0] ? <MoreButton target={targets[0]} /> : null}
      </Targets.Provider>
    </div>
  );
};
