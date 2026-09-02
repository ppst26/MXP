import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { PayoutStatus, Route } from "../mock/types";
import { DEFAULT_LIST_PAGE_SIZE, type ListPageSize } from "../lib/pagination";
import { NOW, applyPreset, type DatePreset } from "../lib/bangkok";

export type Filters = {
  from: Date;
  to: Date;
  preset: DatePreset;
  merchantId: string;
  route: "" | Route;
  statuses: PayoutStatus[];
  q: string;
  recipientAccount: string;
  nameMismatch: boolean;
  recipientBankCode: string;
  listPage: number;
  listPageSize: ListPageSize;
  batchId: string;
  batchStatus: string;
  batchQ: string;
  batchStuck: boolean;
  batchListPage: number;
  batchListPageSize: ListPageSize;
};

const today = applyPreset("today");

const initial: Filters = {
  from: today.from,
  to: today.to,
  preset: "today",
  merchantId: "",
  route: "",
  statuses: [],
  q: "",
  recipientAccount: "",
  nameMismatch: false,
  recipientBankCode: "",
  listPage: 1,
  listPageSize: DEFAULT_LIST_PAGE_SIZE,
  batchId: "",
  batchStatus: "",
  batchQ: "",
  batchStuck: false,
  batchListPage: 1,
  batchListPageSize: DEFAULT_LIST_PAGE_SIZE,
};

type Ctx = {
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
  setPreset: (name: DatePreset) => void;
  now: Date;
};

const FilterContext = createContext<Ctx | null>(null);

export function FilterProvider({ children }: { children: ReactNode }) {
  const [filters, set] = useState<Filters>(initial);
  const value = useMemo<Ctx>(
    () => ({
      filters,
      now: NOW,
      setFilters: (patch) => set((f) => ({ ...f, ...patch })),
      setPreset: (name) => {
        const p = applyPreset(name);
        set((f) => ({ ...f, from: p.from, to: p.to, preset: p.preset, listPage: 1, batchListPage: 1 }));
      },
    }),
    [filters],
  );
  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilters(): Ctx {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilters outside FilterProvider");
  return ctx;
}
