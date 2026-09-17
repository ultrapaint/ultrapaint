/**
 * Desktop shell. It runs the same server and loads the same web bundle as the browser build;
 * the only native additions are a folder picker and a window. No editor feature lives here.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";

let server: ChildProcess | null = null;

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      const port = typeof a === "object" && a ? a.port : 0;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });

const waitFor = async (url: string, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server did not start: ${url}`);
};

const startServer = async (): Promise<number> => {
  const port = await freePort();
  const serverEntry = path.join(app.getAppPath(), "..", "server", "dist", "bin.mjs");
  const webDist = path.join(app.getAppPath(), "..", "web", "dist");
  server = spawn(process.execPath, [serverEntry, "--port", String(port), "--web-dist", webDist], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "inherit", "inherit"],
  });
  await waitFor(`http://127.0.0.1:${port}/api/health`, 20000);
  return port;
};

app.whenReady().then(async () => {
  const port = await startServer();
  ipcMain.handle("pick-folder", async () => {
    const r = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#1a1a1d",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true },
  });
  await win.loadURL(`http://127.0.0.1:${port}/`);
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  if (server?.pid) server.kill("SIGTERM");
});
