import type { AppContext } from "./context.ts";
import { AppError, Router } from "./router.ts";
import { elementSource } from "./services/source.ts";

export const registerHandlers = (ctx: AppContext): Router => {
  const router = new Router();
  const project = () => {
    const p = ctx.project.current;
    if (!p) {
      throw new AppError("not_configured", "no target repository configured");
    }
    return p;
  };

  router
    .on("health", () => ({ ok: true, version: ctx.version }))
    .on("settings.get", () => ctx.settings.get())
    .on("settings.validate", (s) => ctx.settings.validate(s))
    .on("settings.set", async (s) => {
      const v = await ctx.settings.set(s);
      if (v.ok) {
        await ctx.project.open(
          ctx.settings.get() as NonNullable<ReturnType<typeof ctx.settings.get>>
        );
      }
      return v;
    })
    .on("project.info", () => ctx.project.info())
    .on("host.start", async () => {
      const p = project();
      const status = await p.host.start(p.settings);
      ctx.events.emit("project", await ctx.project.info());
      return status;
    })
    .on("host.stop", async () => {
      const status = await project().host.stop();
      ctx.events.emit("project", await ctx.project.info());
      return status;
    })
    .on("logs.recent", () => ctx.logs.slice(-200))

    .on("screens.list", () => ({ screens: project().screens.list() }))
    .on("screens.templates", () => project().screens.templates())
    .on("screens.create", ({ flow, name, template }) => {
      const s = project().screens.create(flow, name, template);
      ctx.events.emit("screens", { screens: project().screens.list() });
      return s;
    })
    .on("screens.rename", ({ id, name }) => {
      const s = project().screens.rename(id, name);
      ctx.events.emit("screens", { screens: project().screens.list() });
      return s;
    })
    .on("screens.duplicate", ({ id }) => {
      const s = project().screens.duplicate(id);
      ctx.events.emit("screens", { screens: project().screens.list() });
      return s;
    })
    .on("screens.delete", ({ id }) => {
      project().screens.delete(id);
      ctx.events.emit("screens", { screens: project().screens.list() });
    })
    .on("canvas.get", ({ flow }) => project().screens.readCanvas(flow))
    .on("canvas.set", ({ flow, layout }) => {
      project().screens.writeCanvas(flow, layout);
    })

    .on("source.read", ({ file }) => {
      const { content, hash } = project().edit.read(file);
      return { content, hash };
    })
    .on("source.element", (loc) => {
      const p = project();
      const { content } = p.edit.read(loc.file);
      return elementSource(
        content,
        loc.file,
        loc,
        p.paths.isEditable(loc.file)
      );
    })
    .on("edit.apply", ({ op, expectedHash }) =>
      project().edit.apply(op, expectedHash)
    )
    .on("edit.undo", () => project().edit.undo())
    .on("edit.redo", () => project().edit.redo())
    .on("edit.state", () => project().edit.state())

    .on("catalogue.get", ({ refresh }) => project().catalogue.get(refresh))
    .on("catalogue.storyUrl", ({ storyId }) =>
      project().catalogue.storyUrl(storyId)
    )

    .on("agents.list", () => ctx.threads.agents())
    .on("threads.list", () => ctx.threads.list())
    .on("threads.create", ({ agentId, title }) =>
      ctx.threads.create(agentId, title)
    )
    .on("threads.items", ({ threadId }) => ctx.threads.items(threadId))
    .on("threads.prompt", (input) => ctx.threads.prompt(input))
    .on("threads.cancel", ({ threadId }) => ctx.threads.cancel(threadId))
    .on("threads.delete", ({ threadId }) => ctx.threads.delete(threadId))
    .on("threads.permission", ({ threadId, requestId, optionId, remember }) =>
      ctx.threads.resolvePermission(threadId, requestId, optionId, remember)
    )
    .on("threads.setMode", ({ threadId, modeId }) =>
      ctx.threads.setMode(threadId, modeId)
    )
    .on("threads.setConfigOption", ({ threadId, optionId, value }) =>
      ctx.threads.setConfigOption(threadId, optionId, value)
    )

    .on("git.status", () => project().git.status())
    .on("git.diff", ({ path: p }) => project().git.diff(p))
    .on("git.commit", async ({ message, paths }) => {
      const sha = await project().git.commit(message, paths);
      ctx.events.emit("git", await project().git.status());
      return { sha };
    })
    .on("checkpoints.list", () => ctx.threads.checkpoints())
    .on("checkpoints.diff", ({ id }) => ctx.threads.checkpointDiff(id))
    .on("checkpoints.revert", ({ id }) => ctx.threads.revertCheckpoint(id));

  return router;
};
