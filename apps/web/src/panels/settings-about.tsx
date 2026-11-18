/**
 * Settings › About: the version running and its update, where the person's things are kept, and
 * where to read more or report a problem.
 */
import type { UpdateCheck } from "@ultrapaint/contracts/shell-bridge";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  UpdateButton,
  updateLabel,
  useAppUpdate,
} from "../components/app-update.tsx";
import { Logo } from "../components/logo.tsx";
import { platform, serverAddress } from "../platform.ts";
import { Group, Row, Status } from "./settings-group.tsx";

const REPOSITORY = "https://github.com/ultrapaint/ultrapaint";

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

export const AboutSection = ({ folders }: { folders?: React.ReactNode }) => {
  const version = useVersion();
  return (
    <>
      <div className="flex items-center gap-4 px-4" data-setting="version">
        <Logo className="size-10" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="font-heading-small">Ultrapaint</h3>
          {version ? (
            <span className="font-code text-muted-foreground">{version}</span>
          ) : null}
        </div>
        <UpdateState />
      </div>
      {folders}
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
