import { contextBridge, ipcRenderer } from "electron";

// The editor reads `window.ultrapaintPlatform` through `@ultrapaint/client-runtime`; this is
// the whole native surface the desktop shell adds.
contextBridge.exposeInMainWorld("ultrapaintPlatform", {
  kind: "desktop",
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
});
