import { describe, expect, it } from "vitest";
import { userFolderLocationFile } from "./user-folder.ts";

describe("where the person's folder's location is kept", () => {
  it("is in the system's per-user configuration folder", () => {
    expect(
      userFolderLocationFile({ env: {}, home: "/home/u", platform: "linux" })
    ).toBe("/home/u/.config/Ultrapaint/user-folder.json");
    expect(
      userFolderLocationFile({
        env: { XDG_CONFIG_HOME: "/cfg" },
        home: "/home/u",
        platform: "linux",
      })
    ).toBe("/cfg/Ultrapaint/user-folder.json");
    expect(
      userFolderLocationFile({ env: {}, home: "/Users/u", platform: "darwin" })
    ).toBe("/Users/u/Library/Application Support/Ultrapaint/user-folder.json");
    expect(
      userFolderLocationFile({
        env: { APPDATA: "C:/Users/u/AppData/Roaming" },
        home: "C:/Users/u",
        platform: "win32",
      })
    ).toBe("C:/Users/u/AppData/Roaming/Ultrapaint/user-folder.json");
  });
});
