import {
  Connection,
  type ConnectionState,
  defaultServerUrl,
} from "@ultrapaint/client-runtime/connection";
import { getPlatform } from "@ultrapaint/client-runtime/platform";
import { create } from "zustand";

interface ConnectionStore {
  connection: Connection;
  state: ConnectionState;
}

const platform = getPlatform();
const url = platform.serverUrl
  ? `${platform.serverUrl.replace(/^http/, "ws")}/ws`
  : defaultServerUrl();

export const useConnection = create<ConnectionStore>((set) => ({
  connection: new Connection({ onState: (state) => set({ state }), url }),
  state: "connecting",
}));

export const api = () => useConnection.getState().connection;
