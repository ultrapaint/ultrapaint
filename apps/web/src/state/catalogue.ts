import type { Catalogue } from "@ultrapaint/contracts/catalogue";
import { create } from "zustand";
import { api } from "./connection.ts";
import { reportError } from "./project.ts";

interface CatalogueStore {
  catalogue: Catalogue | null;
  load: (refresh?: boolean) => Promise<void>;
  loading: boolean;
}

export const useCatalogue = create<CatalogueStore>((set) => ({
  catalogue: null,
  load: async (refresh = false) => {
    set({ loading: true });
    try {
      const catalogue = await api().request("catalogue.get", { refresh });
      set({ catalogue });
    } catch (error) {
      reportError(error);
    } finally {
      set({ loading: false });
    }
  },
  loading: false,
}));
