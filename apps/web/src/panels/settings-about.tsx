/**
 * Settings › About: the version running and its update, where the person's things are kept, the
 * Node.js a new application needs, and where to read more or report a problem.
 */
import type {
  NodeStatus,
  UpdateCheck,
} from "@ultrapaint/contracts/shell-bridge";
import { ExternalLink } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  UpdateButton,
  updateLabel,
  useAppUpdate,
} from "../components/app-update.tsx";
import { Logo } from "../components/logo.tsx";
import { isMac } from "../lib/keys.ts";
import { devCheckout, devCheckoutLabel } from "../lib/ultrapaint-dev.ts";
import { platform, serverAddress } from "../platform.ts";
import { CopyLine } from "./settings-agents.tsx";
import { Group, Row, RowMessage, Status } from "./settings-group.tsx";

const REPOSITORY = "https://github.com/ultrapaint/ultrapaint";
const NODE_DOWNLOAD = "https://nodejs.org/en/download";

/** The version the server runs, as its health answers it; null until it does. */
const useVersion = () => {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(serverAddress("/api/health"), {
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((answer: { version?: string }) =>
        setVersion(answer.version ?? null)
      )
      // Not known: the row says nothing of it.
      .catch(() => setVersion(null));
    return () => controller.abort();
  }, []);
  return version;
};

/**
 * GitHub asked for a newer release as About opens (ADR 0104), rather than the last hourly check
 * taken for an answer: a release out since then is found now. A shell that cannot ask (one from
 * before the check) answers `unavailable`.
 */
const useCheckNow = () => {
  const [check, setCheck] = useState<UpdateCheck | "checking">("checking");
  useEffect(() => {
    let open = true;
    const settle = (next: UpdateCheck) => {
      if (open) {
        setCheck(next);
      }
    };
    const ask = platform().checkUpdate;
    if (ask) {
      ask().then(settle, () => settle("failed"));
    } else {
      settle("unavailable");
    }
    return () => {
      open = false;
    };
  }, []);
  return check;
};

/** What the check asked as About opened says, while there is no update to act on. */
const CheckStatus = ({ check }: { check: UpdateCheck | "checking" }) => {
  switch (check) {
    case "checking":
      return <Status tone="muted">Checking for updates…</Status>;
    case "newer":
      // Found, and still downloading: the update's button replaces this once it is ready.
      return <Status tone="muted">Downloading the update…</Status>;
    case "failed":
      return <Status tone="warning">Couldn’t check for updates</Status>;
    case "current":
      return <Status tone="success">Up to date</Status>;
    default:
      return null;
  }
};

/**
 * The app's update: the one action when there is one; otherwise what the check asked as About
 * opened found, announced as it changes (desktop only).
 */
const UpdateState = () => {
  const update = useAppUpdate();
  const check = useCheckNow();
  if (!platform().update) {
    return null;
  }
  // The status region stays as the update becomes ready, so a screen reader hears that too.
  return (
    <>
      <div role="status">
        {update ? (
          <span className="sr-only">{updateLabel(update)}</span>
        ) : (
          <CheckStatus check={check} />
        )}
      </div>
      {update ? <UpdateButton /> : null}
    </>
  );
};

const LinkButton = ({ children, href }: { children: string; href: string }) => (
  <Button
    nativeButton={false}
    render={<a href={href} rel="noreferrer" target="_blank" />}
    variant="ghost"
  >
    {children}
    <ExternalLink />
  </Button>
);

/**
 * The person's Node.js as the shell finds it (ADR 0105), asked as About opens and again on
 * Check again; null while it is asked, `unreachable` when the shell could not be asked.
 */
const useNodeStatus = () => {
  const ask = platform().node?.status;
  const [status, setStatus] = useState<NodeStatus | "unreachable" | null>(null);
  useEffect(() => {
    let open = true;
    ask?.().then(
      (found) => open && setStatus(found),
      () => open && setStatus("unreachable")
    );
    return () => {
      open = false;
    };
  }, [ask]);
  const check = () => {
    setStatus(null);
    ask?.().then(setStatus, () => setStatus("unreachable"));
  };
  return { check, status };
};

/** How to put a Node that is missing or too old right: the install command, the download. */
const InstallNode = ({ children }: { children: ReactNode }) => (
  <RowMessage kind="notice">
    <div className="flex flex-col items-start gap-2">
      <p>{children}</p>
      {isMac ? <CopyLine command="brew install node" label="Node.js" /> : null}
      <a
        className="text-foreground underline decoration-foreground/30 underline-offset-3 hover:decoration-foreground"
        href={NODE_DOWNLOAD}
        rel="noreferrer"
        target="_blank"
      >
        Download Node.js
      </a>
    </div>
  </RowMessage>
);

/** Check again searches the PATH the login shell gave as Ultrapaint started. */
const RESTART =
  "If the install added a folder to your PATH, restart Ultrapaint instead.";

const NEEDED =
  "A new application installs its packages and runs with Node.js 22.12 or newer, or 20.19 or newer on Node.js 20.";

/**
 * The Node.js on this computer's PATH, its version, and what is wrong with it: the one place the
 * notice over the editor's Details opens (ADR 0105). Shown where the shell can tell (desktop).
 */
const NodeRow = () => {
  const { check, status } = useNodeStatus();
  const again = (
    <Button disabled={status === null} onClick={check} variant="outline">
      {status === null ? (
        <>
          <Spinner />
          Checking…
        </>
      ) : (
        "Check again"
      )}
    </Button>
  );
  const found =
    status && status !== "unreachable" && "path" in status ? (
      <span className="break-all">{status.path}</span>
    ) : null;
  const description: ReactNode = found ?? NEEDED;
  // Check again until it is ready.
  const retry =
    typeof status === "object" && status?._tag === "Ready" ? null : again;
  /** What was found, in a word or two: announced as it changes, Check again kept outside it. */
  let word: ReactNode = null;
  let message: ReactNode = null;
  if (status === "unreachable") {
    message = (
      <RowMessage kind="error">
        <p>Couldn’t check for Node.js. Check again, or restart Ultrapaint.</p>
      </RowMessage>
    );
  } else if (status?._tag === "Ready") {
    word = <Status tone="success">{status.version}</Status>;
  } else if (status?._tag === "Missing") {
    word = <Status tone="warning">Not installed</Status>;
    message = (
      <InstallNode>Install it, then check again. {RESTART}</InstallNode>
    );
  } else if (status?._tag === "TooOld") {
    word = <Status tone="warning">{status.version}, too old</Status>;
    message = (
      <InstallNode>
        {NEEDED} Install a newer one, then check again. {RESTART}
      </InstallNode>
    );
  } else if (status?._tag === "Failed") {
    word = <Status tone="warning">Didn’t run</Status>;
    message = (
      <RowMessage kind="notice">
        <div className="flex flex-col gap-1">
          <p>
            <code className="break-all font-code text-foreground">
              node --version
            </code>{" "}
            failed: {status.reason}
          </p>
          <p>
            Ultrapaint runs it with the PATH your login shell sets. A version
            manager’s node may need a default version set first.
          </p>
        </div>
      </RowMessage>
    );
  }
  return (
    <Row
      description={description}
      message={message}
      setting="node"
      title="Node.js"
    >
      <div className="flex items-center gap-3">
        <div role="status">{word}</div>
        {retry}
      </div>
    </Row>
  );
};

export const AboutSection = ({ folders }: { folders?: React.ReactNode }) => {
  const serverVersion = useVersion();
  // Ultrapaint Dev runs a commit, which says more than the version its checkout names.
  const dev = devCheckout();
  const version = dev ? devCheckoutLabel(dev) : serverVersion;
  return (
    <>
      <div className="flex items-center gap-4 px-4" data-setting="version">
        <Logo className="size-10" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="font-heading-small">
            {dev ? "Ultrapaint Dev" : "Ultrapaint"}
          </h3>
          {version ? (
            <span className="font-code text-muted-foreground">{version}</span>
          ) : null}
        </div>
        <UpdateState />
      </div>
      {folders}
      {platform().node ? (
        <Group>
          <NodeRow />
        </Group>
      ) : null}
      <Group>
        <Row setting="documentation" title="Documentation">
          <LinkButton href={REPOSITORY}>Open</LinkButton>
        </Row>
        <Row
          description="On GitHub. Say what you did and what happened."
          setting="report"
          title="Report a problem"
        >
          <LinkButton href={`${REPOSITORY}/issues/new`}>Open</LinkButton>
        </Row>
      </Group>
    </>
  );
};
