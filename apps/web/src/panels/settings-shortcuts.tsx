/**
 * Settings › Shortcuts: every command's keys in the palette's groups, each the person's to change
 * (ADR 0090). Clicking a command's keys records the next chord pressed and saves it at once
 * (ADR 0079); Escape cancels, Backspace or Delete takes the keys away. A chord another command
 * has, or one the browser keeps, is refused under the row.
 */
import { RotateCcw, Search } from "lucide-react";
import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import { IconButton } from "../components/icon-button.tsx";
import {
  chordOf,
  chordParts,
  chordText,
  type Keys,
  keysLabel,
} from "../lib/keys.ts";
import {
  canTake,
  type Refusal,
  recordKeys,
  refusalText,
  removeKeys,
  resetKeys,
  rowsByGroup,
  type ShortcutRow,
  searchShortcuts,
  shortcutRows,
  takeKeys,
} from "../lib/rebind.ts";
import { useKeybindings } from "../state/keybindings.ts";
import { Group, RowMessage } from "./settings-group.tsx";

/** A command's keys as caps, a chord's keys side by side and its chords apart. */
const Caps = ({ keys }: { keys: readonly Keys[] }) => (
  <span className="inline-flex items-center gap-1.5">
    {keys.map((k, i) => {
      const text = chordText(k);
      return (
        <Fragment key={text}>
          {i > 0 ? (
            <span className="font-body-small text-muted-foreground">or</span>
          ) : null}
          <span className="inline-flex items-center gap-0.5">
            {chordParts(text).map((part, j) => (
              // A chord names a key once: its place is its key.
              // biome-ignore lint/suspicious/noArrayIndexKey: parts of one chord never move
              <Kbd key={j}>{part}</Kbd>
            ))}
          </span>
        </Fragment>
      );
    })}
  </span>
);

/** What a row says of its keys now, to a screen reader. */
const keysSaid = (keys: readonly Keys[]) =>
  keys.length > 0 ? keysLabel(keys) : "no shortcut";

/** What the section says aloud: recording, a change, or a refusal. */
type Say = (words: string) => void;

const ShortcutLine = ({
  onRecording,
  recording,
  refusal,
  row,
  say,
  setRefusal,
}: {
  onRecording: (recording: boolean) => void;
  recording: boolean;
  refusal: Refusal | null;
  row: ShortcutRow;
  say: Say;
  setRefusal: (refusal: Refusal | null) => void;
}) => {
  const { binding, changed, fixed, keys } = row;
  const keysButton = useRef<HTMLButtonElement>(null);
  /** The key that ended a recording, whose keyup must not click the button again. */
  const ended = useRef<boolean>(false);
  const messageId = `shortcut-${binding.id}-message`;

  /** Says the keys the command has after a change, and keeps the focus on them. */
  const changedTo = () => {
    const now = shortcutRows().find((r) => r.binding.id === binding.id);
    say(`${binding.title}: ${keysSaid(now?.keys ?? [])}.`);
    keysButton.current?.focus();
  };

  const refuse = (next: Refusal | null) => {
    setRefusal(next);
    if (next) {
      say(refusalText(next));
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!recording) {
      return;
    }
    const plain = !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey);
    // Tab leaves, as from any button: the blur ends the recording.
    if (e.key === "Tab" && !(e.metaKey || e.ctrlKey || e.altKey)) {
      return;
    }
    // Nothing else reaches the dialog, which Escape would close, or the editor.
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      ended.current = true;
      onRecording(false);
      say(`${binding.title}: ${keysSaid(keys)}.`);
      return;
    }
    if (plain && (e.key === "Backspace" || e.key === "Delete")) {
      ended.current = true;
      onRecording(false);
      removeKeys(binding);
      changedTo();
      return;
    }
    const chord = chordOf(e.nativeEvent);
    if (chord === null) {
      // A modifier alone: the chord isn't pressed yet.
      return;
    }
    ended.current = true;
    onRecording(false);
    const refused = recordKeys(binding, chord);
    if (refused) {
      refuse(refused);
    } else {
      changedTo();
    }
  };

  return (
    <div className="flex flex-col gap-2 px-4 py-1.5">
      <div className="flex min-h-7 items-center gap-1">
        <span className="min-w-0 text-pretty font-body">{binding.title}</span>
        {changed ? (
          <IconButton
            className="text-muted-foreground"
            label={`Reset ${binding.title} to default`}
            onClick={() => {
              const refused = resetKeys(binding);
              refuse(refused);
              if (!refused) {
                changedTo();
              }
            }}
            size="icon-xs"
            tooltip="Reset to default"
          >
            <RotateCcw />
          </IconButton>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center pl-4">
          {fixed ? (
            <span className="inline-flex h-7 items-center px-1.5">
              <Caps keys={keys} />
            </span>
          ) : (
            <button
              aria-describedby={refusal ? messageId : undefined}
              aria-label={
                recording
                  ? `Press a shortcut for ${binding.title}`
                  : `Change the shortcut for ${binding.title}: ${keysSaid(keys)}`
              }
              className={cn(
                "inline-flex h-7 items-center rounded-md px-1.5 outline-none transition-colors duration-100 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                recording && "bg-accent ring-2 ring-ring"
              )}
              onBlur={() => {
                if (recording) {
                  onRecording(false);
                }
              }}
              onClick={() => {
                if (recording) {
                  return;
                }
                setRefusal(null);
                onRecording(true);
                say(
                  `Press a shortcut for ${binding.title}. Escape cancels; Backspace removes it.`
                );
              }}
              onKeyDown={onKeyDown}
              onKeyUp={(e) => {
                if (ended.current) {
                  ended.current = false;
                  e.preventDefault();
                }
              }}
              ref={keysButton}
              type="button"
            >
              {recording || keys.length === 0 ? (
                <span className="font-body-small text-muted-foreground">
                  {recording ? "Press a shortcut…" : "Add shortcut"}
                </span>
              ) : (
                <Caps keys={keys} />
              )}
            </button>
          )}
        </div>
      </div>
      {refusal ? (
        <RowMessage id={messageId} kind="notice">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{refusalText(refusal)}</span>
            {canTake(refusal) ? (
              <Button
                onClick={() => {
                  takeKeys(binding, refusal.chord);
                  setRefusal(null);
                  changedTo();
                }}
                size="xs"
                variant="outline"
              >
                Use it here
              </Button>
            ) : null}
          </div>
        </RowMessage>
      ) : null}
    </div>
  );
};

/** Settings › Shortcuts, the section's whole content. */
export const ShortcutsSection = () => {
  const overrides = useKeybindings((s) => s.overrides);
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<string | null>(null);
  const [refused, setRefused] = useState<{
    id: string;
    refusal: Refusal;
  } | null>(null);
  const [said, setSaid] = useState("");
  // Read again on every change of the person's keys, which `overrides` draws this on.
  const found = searchShortcuts(shortcutRows(), query);
  const groups = rowsByGroup(found);
  const anyChanged = Object.keys(overrides).length > 0;

  const resetAll = () => {
    const before = overrides;
    useKeybindings.getState().resetAll();
    setRefused(null);
    toast("Shortcuts reset", {
      action: {
        label: "Undo",
        onClick: () => useKeybindings.getState().setAll(before),
      },
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-2" data-setting="shortcuts">
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search shortcuts"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Escape clears the search first, and closes the dialog after.
              if (e.key === "Escape" && query) {
                e.stopPropagation();
                setQuery("");
              }
            }}
            placeholder="Search shortcuts"
            value={query}
          />
        </InputGroup>
        {anyChanged ? (
          <Button onClick={resetAll} size="sm" variant="ghost">
            Reset all
          </Button>
        ) : null}
      </div>
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="font-body text-muted-foreground">
            No shortcut matches “{query.trim()}”.
          </p>
          <Button onClick={() => setQuery("")} size="sm" variant="outline">
            Clear search
          </Button>
        </div>
      ) : (
        groups.map(({ group, rows }) => (
          <Group key={group} title={group}>
            {rows.map((row) => (
              <ShortcutLine
                key={row.binding.id}
                onRecording={(on) => {
                  setRecording(on ? row.binding.id : null);
                }}
                recording={recording === row.binding.id}
                refusal={
                  refused?.id === row.binding.id ? refused.refusal : null
                }
                row={row}
                say={setSaid}
                setRefusal={(refusal) =>
                  setRefused(refusal ? { id: row.binding.id, refusal } : null)
                }
              />
            ))}
          </Group>
        ))
      )}
    </div>
  );
};
