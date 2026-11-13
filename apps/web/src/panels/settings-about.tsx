/**
 * Settings › About: the version running and its update, where the person's things are kept, and
 * where to read more or report a problem.
 */
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { UpdateButton, useAppUpdate } from "../components/app-update.tsx";
import { Logo } from "../components/logo.tsx";
import { platform } from "../platform.ts";
import { Group, Row, Status } from "./settings-group.tsx";

const REPOSITORY = "https://github.com/ultrapaint/ultrapaint";

/** The version the server runs, as its health answers it; null until it does. */
const useVersion = () => {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    // The server's own address, from the socket's: ws(s)://host/ws answers http(s)://host/api.
    const health = new URL("/api/health", platform().serverUrl);
    health.protocol = health.protocol === "wss:" ? "https:" : "http:";
    fetch(health, {
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

/** The app's update: the one action when there is one, up to date otherwise (desktop only). */
const UpdateState = () => {
  const update = useAppUpdate();
  if (!platform().update) {
    return null;
  }
  return update ? <UpdateButton /> : <Status tone="success">Up to date</Status>;
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
