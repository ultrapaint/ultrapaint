import {
  Connection,
  type ConnectionState,
  defaultServerUrl,
  getPlatform,
} from "@ultrapaint/client-runtime";
import { create } from "zustand";

interface ConnectionStore {
  state: ConnectionState;
  connection: Connection;
}

const platform = getPlatform();
const url = platform.serverUrl
  ? `${platform.serverUrl.replace(/^http/, "ws")}/ws`
  : defaultServerUrl();

export const useConnection = create<ConnectionStore>((set) => ({
  state: "connecting",
  connection: new Connection({ url, onState: (state) => set({ state }) }),
}));

export const api = () => useConnection.getState().connection;
