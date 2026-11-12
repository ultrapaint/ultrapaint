/**
 * A point of the history, clicked: each page it changed as it was before and after, drawn by the
 * canvas's own renderer from the documents the point and the one before it kept (ADR 0087), with
 * the way back to it. What a point kept never changes, so a picture drawn once is kept for the
 * session.
 */
import type { HistoryPoint, PageChange } from "@ultrapaint/contracts/snapshots";
import { basename, humanise } from "@ultrapaint/shared/path";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { drawSpecimen } from "../canvas/specimens.ts";
import { pointTitle } from "../lib/history-words.ts";
import { api } from "../state/connection.ts";
import { useDesignSystem } from "../state/design-system.ts";
import { useEditor } from "../state/editor.ts";
import { useProject } from "../state/project.ts";

/** At most this many pages are drawn; the rest are counted. */
const PAGES_SHOWN = 4;
/** Twice the width a picture is shown at. */
const PICTURE_WIDTH = 360;

const PAGE_SUFFIX_RE = /\.page\.json$/;

/** The pictures drawn, by point, page and side: a point's pages never change. */
const drawn = new Map<string, Promise<string | null>>();

/** Scales a page's picture down to the width it is shown at, from its top. */
const scaled = (dataUrl: string) =>
  new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = PICTURE_WIDTH / img.width;
      const canvas = document.createElement("canvas");
      canvas.width = PICTURE_WIDTH;
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      // A page is drawn in the design's look over its own ground: white, as on the canvas.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

const pageOf = (file: string) =>
  useProject.getState().pages.find((p) => p.file === file);

/** A page's picture as the point kept it, drawn at its frame's size. */
const pictureOf = (
  point: HistoryPoint,
  change: PageChange,
  side: "before" | "after"
) => {
  const key = `${point.id}:${change.file}:${side}`;
  const root = change[side];
  if (!root) {
    return Promise.resolve(null);
  }
  let picture = drawn.get(key);
  if (!picture) {
    const page = pageOf(change.file);
    const frame = page ? useEditor.getState().frames[page.id] : undefined;
    picture = drawSpecimen(root, useDesignSystem.getState().designSystem, {
      canvas: page?.canvas ?? "",
      height: frame?.height ?? 900,
      mode: "page",
      width: frame?.width ?? 1440,
    })
      .then((shot) => (shot ? scaled(shot) : null))
      .catch(() => null);
    drawn.set(key, picture);
  }
  return picture;
};

const nameOf = (file: string) =>
  pageOf(file)?.name ?? humanise(basename(file).replace(PAGE_SUFFIX_RE, ""));

/** One side of a page: its picture, a skeleton while it is drawn, or a word when there is none. */
const Picture = ({
  change,
  point,
  side,
}: {
  change: PageChange;
  point: HistoryPoint;
  side: "before" | "after";
}) => {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    pictureOf(point, change, side).then((picture) => {
      if (live) {
        setSrc(picture);
      }
    });
    return () => {
      live = false;
    };
  }, [point, change, side]);
  let inside: ReactNode;
  if (src) {
    inside = (
      <img
        alt={`${nameOf(change.file)}, ${side}`}
        className="size-full object-cover object-top"
        height={110}
        src={src}
        width={176}
      />
    );
  } else if (src === undefined) {
    inside = (
      <span className="block size-full bg-foreground/5 motion-safe:animate-pulse" />
    );
  } else {
    inside = (
      <span className="flex size-full items-center justify-center font-body-small text-muted-foreground">
        {change[side] ? "Not drawn" : "Not there"}
      </span>
    );
  }
  return (
    <div className="aspect-16/10 overflow-hidden rounded-md bg-muted ring-1 ring-border">
      {inside}
    </div>
  );
};

/**
 * The preview's body: the point's words and what is said under them, Before and After over
 * their columns once, each page's name over its pair, and Restore.
 */
export const PointPreview = ({
  meta,
  onRestore,
  point,
}: {
  /** What the row says under the point's words. */
  meta: ReactNode;
  onRestore: () => void;
  point: HistoryPoint;
}) => {
  const [changes, setChanges] = useState<readonly PageChange[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api()
      .request("history.compare", { id: point.id })
      .then(
        (read) => live && setChanges(read),
        () => live && setFailed(true)
      );
    return () => {
      live = false;
    };
  }, [point.id]);
  const shown = changes?.slice(0, PAGES_SHOWN) ?? [];
  const more = (changes?.length ?? 0) - shown.length;
  let body: ReactNode;
  if (failed) {
    body = (
      <p className="font-body-small text-muted-foreground">
        The pages didn’t load
      </p>
    );
  } else if (changes === null) {
    body = (
      <div className="grid grid-cols-2 gap-2">
        <span className="aspect-16/10 rounded-md bg-foreground/5 motion-safe:animate-pulse" />
        <span className="aspect-16/10 rounded-md bg-foreground/5 motion-safe:animate-pulse" />
      </div>
    );
  } else if (changes.length === 0) {
    body = (
      <p className="font-body-small text-muted-foreground">
        No page changed: {plainFiles(point)}
      </p>
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <div className="-mb-2 grid grid-cols-2 gap-2 font-body-small-medium text-muted-foreground">
          <span>Before</span>
          <span>After</span>
        </div>
        {shown.map((change) => (
          <div className="flex flex-col gap-1.5" key={change.file}>
            <span className="truncate font-body-medium">
              {nameOf(change.file)}
            </span>
            <div className="grid grid-cols-2 gap-2">
              <Picture change={change} point={point} side="before" />
              <Picture change={change} point={point} side="after" />
            </div>
          </div>
        ))}
        {more > 0 ? (
          <p className="font-body-small text-muted-foreground">
            And {more} more {more === 1 ? "page" : "pages"}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <p className="line-clamp-2 font-body-semibold">{pointTitle(point)}</p>
        <div className="flex min-w-0 items-center gap-1 font-body-small text-muted-foreground">
          {meta}
        </div>
      </div>
      {body}
      <div className="flex justify-end">
        <Button onClick={onRestore} size="sm">
          Restore
        </Button>
      </div>
    </div>
  );
};

/** The files a point changed that are not pages, said by name. */
const plainFiles = (point: HistoryPoint) =>
  point.files.map((f) => basename(f)).join(", ");
