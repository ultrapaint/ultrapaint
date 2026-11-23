/**
 * Problems' panel (ADR 0106): what the design system's files and the sync say needs fixing,
 * grouped by the file it is read from, each with what it costs and its fix: a chat drafted to fix
 * it, or the Sync for a step that waits there; its menu shows it in its file, or leaves a warning
 * as it is, for the person or the project. Fix all drafts one chat for every problem an agent
 * can fix. The rail shows its item only while there is something here, so none is said only when
 * the last one was fixed with the panel open.
 */
import {
  CircleAlert,
  CircleCheck,
  Ellipsis,
  EyeOff,
  FileCode,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import { IconButton } from "../components/icon-button.tsx";
import { PanelEmpty } from "../components/panel.tsx";
import {
  fixPrompt,
  ignorable,
  type Problem,
  type ProblemSource,
} from "../lib/problems.ts";
import { startPrompt } from "../lib/start-thread.ts";
import { api } from "../state/connection.ts";
import { useDesignSystemSetup } from "../state/design-system-setup.ts";
import { showLeftPanel } from "../state/panels.ts";
import { setIgnored, useProblemIds, useProblems } from "../state/problems.ts";
import { reportError } from "../state/project.ts";

const QUOTED = /`([^`]+)`/;

/** A problem's words, a token's name between backticks set in code. */
const Words = ({ text }: { text: string }) =>
  text.split(QUOTED).map((part, i) =>
    i % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one sentence, in its order.
      <span className="text-foreground" key={i}>
        {part}
      </span>
    ) : (
      part
    )
  );

const fix = (problems: readonly Problem[]) => startPrompt(fixPrompt(problems));

/** The Sync, where a waiting step is answered: Design System mode's panel, on its Sync view. */
const reviewSync = () => {
  useDesignSystemSetup.getState().show(true);
  showLeftPanel("designSystem");
};

const SeverityIcon = ({ problem }: { problem: Problem }) => {
  if (problem.fix === "sync") {
    return <RefreshCw className="size-3.5 text-muted-foreground" />;
  }
  return problem.severity === "error" ? (
    <CircleAlert className="size-3.5 text-destructive" />
  ) : (
    <TriangleAlert className="size-3.5 text-warning" />
  );
};

/** Opens where the problem is written in the person's code editor, at its line. */
const showInFile = (file: NonNullable<Problem["file"]>) =>
  api()
    .request("files.open", {
      path: file.path,
      ...(file.at ? { at: file.at } : {}),
    })
    .catch(reportError);

/**
 * A problem's other actions: where it is written, and leaving it as it is, for the person or for
 * everyone on the project (ADR 0106). Settings lists what was left, to list it again.
 */
const More = ({ problem }: { problem: Problem }) => {
  const present = useProblemIds();
  const { file } = problem;
  const leave = ignorable(problem);
  if (!(file || leave)) {
    return null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton
            className="text-muted-foreground"
            size="icon-sm"
            tooltip="More"
          />
        }
      >
        <Ellipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {file ? (
          <DropdownMenuItem onClick={() => showInFile(file)}>
            <FileCode />
            Show in file
          </DropdownMenuItem>
        ) : null}
        {file && leave ? <DropdownMenuSeparator /> : null}
        {leave ? (
          <>
            <DropdownMenuItem
              onClick={() => setIgnored(problem.id, "me", true, present)}
            >
              <EyeOff />
              Ignore for me
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setIgnored(problem.id, "project", true, present)}
            >
              <Users />
              Ignore for the project
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** One problem: what is wrong, what it costs, and its fix under them, on the text's edge. */
const Row = ({ problem }: { problem: Problem }) => (
  <li
    aria-label={problem.title.replaceAll("`", "")}
    className="mx-2 grid grid-cols-[0.875rem_1fr] gap-x-2 gap-y-0.5 rounded-md px-2 py-2"
  >
    <span className="flex h-5 items-center">
      <SeverityIcon problem={problem} />
    </span>
    <p className="min-w-0 break-words font-body-medium">
      <Words text={problem.title} />
    </p>
    {problem.detail ? (
      <p
        className={cn(
          "col-start-2 min-w-0 break-words font-body-small text-muted-foreground",
          // A sync step says all of itself in the Sync, a click away.
          problem.fix === "sync" && "line-clamp-3"
        )}
      >
        <Words text={problem.detail} />
      </p>
    ) : null}
    <div className="col-start-2 flex items-center gap-1 pt-1.5">
      {problem.fix === "sync" ? (
        <Button onClick={reviewSync} size="sm" variant="secondary">
          Review
        </Button>
      ) : (
        <Button onClick={() => fix([problem])} size="sm" variant="secondary">
          Fix with agent
        </Button>
      )}
      <More problem={problem} />
    </div>
  </li>
);

/** A group's name over its rows: the file it is read from, or Sync. */
const Heading = ({ source }: { source: ProblemSource }) => (
  <h3 className="flex h-9 items-end px-4 pb-1 font-body-small text-muted-foreground">
    {source}
  </h3>
);

/** The problems in their groups, in the order they come. */
const groupsOf = (problems: readonly Problem[]) => {
  const groups: { problems: Problem[]; source: ProblemSource }[] = [];
  for (const problem of problems) {
    const last = groups.at(-1);
    if (last?.source === problem.source) {
      last.problems.push(problem);
    } else {
      groups.push({ problems: [problem], source: problem.source });
    }
  }
  return groups;
};

export const Problems = () => {
  const problems = useProblems();
  const fixable = problems.filter((p) => p.fix === "agent");
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1.5 pr-2 pl-4">
        <h2 className="font-heading-xsmall">Problems</h2>
        {problems.length > 0 ? (
          <span className="font-body-medium text-muted-foreground tabular-nums">
            {problems.length}
          </span>
        ) : null}
      </div>
      {problems.length === 0 ? (
        <PanelEmpty icon={<CircleCheck />} title="No problems">
          The design system’s files read, and the sync waits for nothing.
        </PanelEmpty>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto pb-2">
          {groupsOf(problems).map((group) => (
            <section aria-label={group.source} key={group.source}>
              <Heading source={group.source} />
              <ul>
                {group.problems.map((problem) => (
                  <Row key={problem.id} problem={problem} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {fixable.length > 1 ? (
        <div className="shrink-0 border-border border-t p-3">
          <Button className="w-full" onClick={() => fix(fixable)}>
            <Sparkles data-icon="inline-start" />
            Fix all with agent
          </Button>
        </div>
      ) : null}
    </div>
  );
};
