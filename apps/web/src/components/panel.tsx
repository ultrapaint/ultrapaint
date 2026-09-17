import type * as React from "react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const Section = ({
  title,
  children,
  actions,
  className,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) => (
  <div className={cn("border-b px-3 py-2.5", className)}>
    <div className="mb-2 flex items-center justify-between">
      <span className="font-medium text-[11px]">{title}</span>
      {actions}
    </div>
    <div className="flex flex-col gap-1.5">{children}</div>
  </div>
);

export const Row = ({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={cn("grid grid-cols-[64px_1fr] items-center gap-2", className)}>
    <Label className="truncate font-normal text-[11px] text-muted-foreground" title={label}>
      {label}
    </Label>
    <div className="flex min-w-0 items-center gap-1">{children}</div>
  </div>
);

export const PanelEmpty = ({
  icon,
  children,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <Empty className="h-full">
    <EmptyHeader>
      {icon && <EmptyMedia variant="icon">{icon}</EmptyMedia>}
      <EmptyDescription>{children}</EmptyDescription>
    </EmptyHeader>
  </Empty>
);
