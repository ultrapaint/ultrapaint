/**
 * Settings › Name and icon (ADR 0107), first of the project's sections: how the project is shown
 * on its tab and in the sidebar, kept in its configuration so the team sees the same. The name,
 * saved when its field is left; the icon, the one shown now with the arrow back to the default
 * while one is set, and the two ways to set one, each a dialog saving on its Save.
 */
import type { ShownProjectIcon } from "@ultrapaint/contracts/project";
import type { ProjectIcon as ProjectIconValue } from "@ultrapaint/contracts/settings";
import { folderName } from "@ultrapaint/shared/project-name";
import { RotateCcw } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconButton } from "../components/icon-button.tsx";
import { ProjectIcon } from "../components/project-icon.tsx";
import { ChooseFileDialog, ChooseIconDialog } from "./project-icon-dialogs.tsx";
import { Group, Row } from "./settings-group.tsx";

export const NameAndIconSection = ({
  icon,
  leaves,
  message,
  name,
  onIcon,
  onName,
  repoPath,
  shown,
}: {
  /** The icon the settings give; absent, the default is shown. */
  icon: ProjectIconValue | undefined;
  /** Saves the name when its field is left, Enter included. */
  leaves: Pick<React.ComponentProps<"input">, "onBlur" | "onKeyDown">;
  /** Why a change to the row was not saved, under it. */
  message: (row: "icon" | "name") => React.ReactNode;
  name: string | undefined;
  /** Saves the icon at once; `undefined` goes back to the default. */
  onIcon: (icon: ProjectIconValue | undefined) => void;
  onName: (name: string | undefined) => void;
  repoPath: string;
  /** The icon the server shows now, its default included. */
  shown: ShownProjectIcon | undefined;
}) => {
  const [dialog, setDialog] = useState<"icon" | "file" | null>(null);
  const folder = folderName(repoPath);
  const shownName = name?.trim() || folder;
  // The dialogs start from the icon the settings give; the row draws what the server shows for
  // it, so a file that is gone shows the default (the favicon, else the initials in a colour).
  const project = { icon: icon ?? shown, name: shownName, path: repoPath };
  const opened = (which: "icon" | "file") => (open: boolean) =>
    setDialog(open ? which : null);
  return (
    <Group>
      <Row
        description="On the tab and in the sidebar. Left empty, the folder’s name."
        htmlFor="settings-project-name"
        layout="field"
        message={message("name")}
        setting="project-name"
        title="Name"
      >
        <Input
          id="settings-project-name"
          onChange={(e) => onName(e.target.value || undefined)}
          placeholder={folder}
          value={name ?? ""}
          {...leaves}
        />
      </Row>
      <Row
        description={
          icon?.kind === "file" ? (
            <span className="break-all">{icon.path}</span>
          ) : undefined
        }
        message={message("icon")}
        setting="project-icon"
        title="Icon"
      >
        <div className="flex items-center gap-2">
          <ProjectIcon icon={shown} name={shownName} size={28} />
          {icon ? (
            <IconButton
              className="text-muted-foreground"
              onClick={() => onIcon(undefined)}
              tooltip="Use the default"
            >
              <RotateCcw className="size-3.5" />
            </IconButton>
          ) : null}
          <Button onClick={() => setDialog("icon")} variant="outline">
            Choose icon
          </Button>
          <Button onClick={() => setDialog("file")} variant="outline">
            Choose file
          </Button>
        </div>
      </Row>
      <ChooseIconDialog
        onOpenChange={opened("icon")}
        onSave={onIcon}
        open={dialog === "icon"}
        project={project}
      />
      <ChooseFileDialog
        onOpenChange={opened("file")}
        onSave={onIcon}
        open={dialog === "file"}
        project={project}
      />
    </Group>
  );
};
