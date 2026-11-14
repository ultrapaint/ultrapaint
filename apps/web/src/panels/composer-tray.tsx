/**
 * The tray under a design chat's composer (ADR 0095): how the chat works, apart from what is
 * written. The design skills it is told at the start, its review at the end; each a quiet text
 * control opening its menu.
 */
import type { Skill } from "@ultrapaint/contracts/skills";
import type { Thread } from "@ultrapaint/contracts/threads";
import { ChevronDown } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { trayTrigger } from "../components/composer-style.ts";
import { chosenSkills, chosenTitles, skillKey } from "../lib/chat-skills.ts";
import { api } from "../state/connection.ts";
import { reportError, useProject } from "../state/project.ts";
import { useSkills } from "../state/skills.ts";
import { ReviewChip } from "./review-level.tsx";

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((key) => b.includes(key));

/**
 * The chat's skills as the person changes them: back to the project's when they match its
 * defaults. None also turns the review off, as nothing would hold the design to rules; a skill
 * chosen again from none gives the review back to the project.
 */
const setSkills = (
  thread: Thread,
  next: readonly string[],
  defaults: readonly string[]
) => {
  const was = thread.skills;
  const request = api().request("threads.setSkills", {
    skills: sameSet(next, defaults) ? null : [...next],
    threadId: thread.id,
  });
  // None turns the review off; a skill chosen again from none gives it back to the project.
  const backFromNone = was?.length === 0 && thread.review?.on === false;
  let review: Promise<void> | null = null;
  if (next.length === 0 || backFromNone) {
    review = api().request("threads.setReview", {
      review: next.length === 0 ? { on: false } : null,
      threadId: thread.id,
    });
  }
  Promise.all([request, review]).catch(reportError);
};

/** "Ultrapaint", "Ultrapaint +1", "None": the tray's words for the chosen skills. */
const chosenLabel = (titles: readonly string[]) => {
  const [first] = titles;
  if (first === undefined) {
    return "None";
  }
  return titles.length > 1 ? `${first} +${titles.length - 1}` : first;
};

/** A skill in the picker: checked when the chat is told it, "Default" when the project's is. */
const SkillItem = ({
  chosen,
  onToggle,
  skill,
}: {
  chosen: readonly string[];
  onToggle: (key: string, on: boolean) => void;
  skill: Skill;
}) => {
  const key = skillKey(skill);
  return (
    <DropdownMenuCheckboxItem
      checked={chosen.includes(key)}
      closeOnClick={false}
      onCheckedChange={(on) => onToggle(key, on)}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate">{skill.title}</span>
          {skill.enabled ? (
            <span className="ml-auto shrink-0 font-body-small text-muted-foreground">
              Default
            </span>
          ) : null}
        </span>
        <span className="line-clamp-2 font-body-small text-muted-foreground">
          {skill.summary}
        </span>
      </span>
    </DropdownMenuCheckboxItem>
  );
};

/**
 * The Skills picker: the design skill and the project's own, each checked when this chat is told
 * it, "Default" beside the project's; No design skill for a question or code; the settings last.
 */
const SkillPicker = ({ thread }: { thread: Thread }) => {
  const skills = useSkills((s) => s.skills);
  const loaded = useSkills((s) => s.loaded);
  useEffect(() => {
    if (!useSkills.getState().loaded) {
      useSkills.getState().load();
    }
  }, []);
  if (!loaded) {
    return null;
  }
  const defaults = skills.filter((s) => s.enabled).map(skillKey);
  const chosen = chosenSkills(thread, skills);
  const titles = chosenTitles(chosen, skills);
  // The design skill, the project's defaults and what this chat chose; the others a level down.
  const near = skills.filter(
    (s) => s.source === "built-in" || s.enabled || chosen.includes(skillKey(s))
  );
  const other = skills.filter((s) => !near.includes(s));
  const toggle = (key: string, on: boolean) =>
    setSkills(
      thread,
      on ? [...chosen, key] : chosen.filter((k) => k !== key),
      defaults
    );
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label={`Design skills: ${titles.length > 0 ? titles.join(", ") : "None"}`}
                  className={trayTrigger}
                  variant="ghost"
                />
              }
            />
          }
        >
          Skills
          <span className="truncate text-foreground">
            {chosenLabel(titles)}
          </span>
          <ChevronDown
            className="size-3.5 shrink-0 opacity-70"
            data-icon="inline-end"
          />
        </TooltipTrigger>
        {/* The names "+2" stands for, one a line; one skill's name is on the button already. */}
        {titles.length > 1 ? (
          <TooltipContent align="start" className="flex flex-col items-start">
            {titles.map((title) => (
              <span key={title}>{title}</span>
            ))}
          </TooltipContent>
        ) : null}
      </Tooltip>
      <DropdownMenuContent align="start" className="w-72" side="top">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Design skills</DropdownMenuLabel>
          {near.map((skill) => (
            <SkillItem
              chosen={chosen}
              key={skillKey(skill)}
              onToggle={toggle}
              skill={skill}
            />
          ))}
          {/* The rest of the project's skills, off by default: one level down. */}
          {other.length > 0 ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Other skills</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-96 w-72 overflow-y-auto">
                {other.map((skill) => (
                  <SkillItem
                    chosen={chosen}
                    key={skillKey(skill)}
                    onToggle={toggle}
                    skill={skill}
                  />
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={chosen.length === 0}
          onCheckedChange={(on) => {
            if (on) {
              setSkills(thread, [], defaults);
            }
          }}
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span>No design skill</span>
            <span className="font-body-small text-muted-foreground">
              For a question or code: the agent gets no design rules
            </span>
          </span>
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => useProject.getState().openSettings(true, "skills")}
        >
          Skill settings…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * Under the composer, inset from its sides and hung from its lower edge. A thread that writes the
 * code (`implement`) is told no design skill and reviewed by no one: it has no tray.
 */
export const ComposerTray = ({ thread }: { thread: Thread }) =>
  thread.purpose === "implement" ? null : (
    <div className="mx-2 flex h-8 min-w-0 items-center gap-1 rounded-b-lg border border-t-0 bg-rail px-1">
      <SkillPicker thread={thread} />
      <div className="min-w-1 flex-1" />
      <ReviewChip thread={thread} />
    </div>
  );
