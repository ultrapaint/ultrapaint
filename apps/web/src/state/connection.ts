import {
  Connection,
  type ConnectionState,
  defaultServerUrl,
} from "@ultrapaint/client-runtime/connection";
import { create } from "zustand";

interface ConnectionStore {
  connection: Connection;
  state: ConnectionState;
}

export const useConnection = create<ConnectionStore>((set) => ({
  connection: new Connection({
    onState: (state) => set({ state }),
    url: defaultServerUrl(),
  }),
  state: "connecting",
}));

export const api = () => useConnection.getState().connection;
