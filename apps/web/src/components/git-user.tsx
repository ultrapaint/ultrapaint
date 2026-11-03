import { GitBranch, MessageCircle } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useProject } from "../state/project.ts";

const SPACES_RE = /\s+/;

/** Up to two letters of a name: the first of its first and last words. */
const initialsOf = (name: string): string => {
  const words = name.trim().split(SPACES_RE).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
  return (first + last).toUpperCase();
};

/**
 * Who the user is, as git says in this repository, or the display name of their profile when
 * git gives no name: not an account and not a login. The circle shows the initials of the name;
 * the email is in the popup it opens.
 */
export const GitUserButton = () => {
  const user = useProject((s) => s.info.gitUser);
  const displayName = useProject((s) => s.info.displayName);
  const fullName = user?.name ?? displayName;
  const name = fullName ?? user?.email;
  if (!name) {
    return null;
  }
  const initials = initialsOf(fullName ?? "") || name[0]?.toUpperCase();
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            aria-label={`Git user: ${name}`}
            className="flex size-7 items-center justify-center rounded-full border bg-muted font-body font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-popup-open:border-foreground data-popup-open:text-foreground"
            type="button"
          />
        }
      >
        {initials}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-3" side="bottom">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-muted font-body font-semibold">
            {initials}
          </span>
          <div className="flex min-w-0 flex-col">
            {fullName ? (
              <span className="truncate font-semibold">{fullName}</span>
            ) : null}
            {user?.email ? (
              <span className="truncate text-muted-foreground">
                {user.email}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 border-t pt-2.5 font-body text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <GitBranch className="size-3" />
            {user?.name
              ? "From git config in this repository"
              : "Your display name, from Settings"}
          </span>
          <span className="flex items-center gap-1.5">
            <MessageCircle className="size-3" />
            Signs your comments on the canvas
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
};
