/**
 * The slash commands a prompt may start with, as the server lists them: read when a composer
 * first shows, and again at every connection open, the server may be another version by then.
 */
import type { SlashCommand } from "@ultrapaint/contracts/threads";
import { create } from "zustand";
import { api } from "./connection.ts";
import { follow } from "./server-data.ts";

interface SlashCommandsStore {
  commands: readonly SlashCommand[];
  load: () => Promise<void>;
  loaded: boolean;
}

export const useSlashCommands = create<SlashCommandsStore>(() => ({
  commands: [],
  // A composer without the list still sends what was typed: nothing to report.
  load: () => commandsData.read().catch(() => undefined),
  loaded: false,
}));

const commandsData = follow({
  apply: (commands: readonly SlashCommand[]) =>
    useSlashCommands.setState({ commands, loaded: true }),
  read: () => api().request("commands.list", undefined),
});
