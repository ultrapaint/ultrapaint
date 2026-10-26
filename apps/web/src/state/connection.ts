import {
  Connection,
  type ConnectionState,
} from "@ultrapaint/client-runtime/connection";
import { create } from "zustand";
import { platform } from "../platform.ts";

interface ConnectionStore {
  connection: Connection;
  state: ConnectionState;
}

export const useConnection = create<ConnectionStore>((set) => ({
  connection: new Connection({
    onState: (state) => set({ state }),
    url: platform().serverUrl,
  }),
  state: "connecting",
}));

export const api = () => useConnection.getState().connection;
