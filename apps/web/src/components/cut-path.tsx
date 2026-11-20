import { cn } from "@/lib/cn";
import { CutText } from "./cut-text.tsx";

/** A remote project's `host:` or `host:port:` before its folder (`projectDetail`). */
const HOST_RE = /^[^/\\~:]+:(?:\d+:)?(?=[/~])/;

/**
 * A path, a folder or a file on one line, cut at its start when it does not fit, so its last
 * folder or its file name stays in sight, and whole in the tooltip (ADR 0108). The box runs
 * right to left, which moves the cut to its start; the path in it runs left to right, so its
 * slashes stay where they are written. A remote project's host stays whole before the folder,
 * as it tells two copies of one folder apart. `tooltip={false}` inside a row whose own tooltip
 * already says more. Its type is the caller's, a body token; it is a box of its own.
 */
export const CutPath = ({
  className,
  path,
  tooltip = true,
}: {
  className?: string;
  path: string;
  tooltip?: boolean;
}) => {
  const folder = path.replace(HOST_RE, "");
  const host = path.slice(0, path.length - folder.length);
  const cut = {
    children: <bdi dir="ltr">{folder}</bdi>,
    className: "min-w-0 truncate text-left",
    dir: "rtl",
  } as const;
  return (
    <span className={cn("flex min-w-0", className)}>
      {host ? <span className="shrink-0">{host}</span> : null}
      {tooltip ? <CutText {...cut} tip={path} /> : <span {...cut} />}
    </span>
  );
};
