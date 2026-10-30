/**
 * A component's behaviour notes (ADR 0030), on its board's inspector, a system component's and an
 * app component's alike.
 */
import {
  type ComponentFile,
  ROOT_SLOT,
} from "@ultrapaint/contracts/components";
import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { api } from "../state/connection.ts";
import { reportError } from "../state/project.ts";

/**
 * The component's behaviour notes (ADR 0030): what its code must do that the design cannot show,
 * about one part or the whole of it. They go with the component to `/implement`. Added and taken
 * out on the server, on the file as it is there.
 */
export const Notes = ({
  component,
  parts,
}: {
  component: ComponentFile;
  parts: readonly { readonly label?: string; readonly name: string }[];
}) => {
  const [text, setText] = useState("");
  const [slot, setSlot] = useState(ROOT_SLOT);
  const notes = component.notes ?? [];
  const add = async () => {
    if (text.trim() === "") {
      return;
    }
    try {
      await api().request("components.addNote", {
        name: component.name,
        ...(slot !== ROOT_SLOT && { slot }),
        text: text.trim(),
      });
      setText("");
    } catch (error) {
      reportError(error);
    }
  };
  const remove = async (id: string) => {
    try {
      await api().request("components.change", {
        change: { id, op: "removeNote" },
        name: component.name,
      });
    } catch (error) {
      reportError(error);
    }
  };
  const partOf = (name: string | undefined) =>
    parts.find((s) => s.name === name)?.label ?? name;
  const choices = [
    { label: "The component", name: ROOT_SLOT },
    ...parts.filter((p) => p.name !== ROOT_SLOT),
  ];
  return (
    <div className="flex flex-col gap-1.5 font-body">
      {notes.length === 0 ? (
        <p className="text-muted-foreground">
          What the code must do that the design cannot show: it goes to the code
          when the component is implemented.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {notes.map((n) => (
            <li className="flex items-start gap-1.5" key={n.id}>
              <span className="min-w-0 flex-1">
                {n.slot ? (
                  <span className="text-muted-foreground">
                    {partOf(n.slot)}:{" "}
                  </span>
                ) : null}
                {n.text}
              </span>
              <Button
                aria-label="Take the note out"
                onClick={() => remove(n.id)}
                size="icon-xs"
                variant="ghost"
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {/* The part a note is about on a line of its own, so that neither it nor the note is cut. */}
      {choices.length > 1 ? (
        <NativeSelect
          aria-label="About"
          className="w-full"
          onChange={(e) => setSlot(e.target.value)}
          size="sm"
          value={slot}
        >
          {choices.map((s) => (
            <NativeSelectOption key={s.name} value={s.name}>
              {s.label ?? s.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : null}
      <div className="flex gap-1.5">
        <Input
          aria-label="A behaviour note"
          className="h-7 min-w-0 flex-1"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              add();
            }
          }}
          placeholder="Closes on Escape"
          value={text}
        />
        <Button
          disabled={text.trim() === ""}
          onClick={add}
          size="sm"
          variant="outline"
        >
          Note
        </Button>
      </div>
    </div>
  );
};
