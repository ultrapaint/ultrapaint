import { CircleAlert } from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export const PanelEmpty = ({
  action,
  icon,
  title,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  /** The one thing to do about it, under the sentence. */
  action?: React.ReactNode;
  icon?: React.ReactNode;
  /** What is missing, in a few words over the sentence that says what to do. */
  title?: string;
  children?: React.ReactNode;
}) => (
  // A muted icon, a one-line title, one muted sentence, one action (DESIGN.md, Components).
  <Empty className="h-full gap-3 p-4" {...props}>
    <EmptyHeader className="max-w-60">
      {icon ? (
        <EmptyMedia className="mb-1 text-muted-foreground [&_svg:not([class*='size-'])]:size-5">
          {icon}
        </EmptyMedia>
      ) : null}
      {title ? (
        <EmptyTitle className="font-body-medium">{title}</EmptyTitle>
      ) : null}
      {children ? (
        <EmptyDescription className="font-body-small">
          {children}
        </EmptyDescription>
      ) : null}
    </EmptyHeader>
    {action}
  </Empty>
);

/**
 * A panel whose content didn't load, said where the content would be, in its empty state's form
 * (ADR 0080): a muted alert icon, what didn't load in the panel's words ("The layers didn’t
 * load"), the reason in muted text when there is one, and Try again as the empty state's action.
 */
export const PanelFailed = ({
  children,
  onRetry,
  title,
}: {
  /** Why it didn't load, when that is known. */
  children?: React.ReactNode;
  onRetry: () => void;
  title: string;
}) => (
  <PanelEmpty
    action={
      <Button onClick={onRetry} size="sm" variant="secondary">
        Try again
      </Button>
    }
    icon={<CircleAlert />}
    role="alert"
    title={title}
  >
    {children}
  </PanelEmpty>
);
