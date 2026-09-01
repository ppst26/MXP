import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { HouseDemo } from "../mock/query";
import { MOCK_DIRECT_USER } from "../mock/query";
import { useFilters } from "./FilterProvider";

export type Role = "admin" | "merchant";

type Ctx = {
  role: Role;
  isAdmin: boolean;
  demo: HouseDemo;
  scopedMerchantId: string;
  setRole: (role: Role) => void;
  setDemo: (patch: Partial<HouseDemo>) => void;
};

const ViewerContext = createContext<Ctx | null>(null);

const demoOff: HouseDemo = {
  sendOff: false,
  staleBalance: false,
  noSource: false,
  queueExceeds: false,
};

export function ViewerProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>("admin");
  const [demo, setDemoState] = useState<HouseDemo>(demoOff);
  const value = useMemo<Ctx>(
    () => ({
      role,
      isAdmin: role === "admin",
      demo,
      scopedMerchantId: role === "merchant" ? MOCK_DIRECT_USER : "",
      setRole,
      setDemo: (patch) => setDemoState((d) => ({ ...d, ...patch })),
    }),
    [role, demo],
  );
  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

export function useViewer(): Ctx {
  const ctx = useContext(ViewerContext);
  if (!ctx) throw new Error("useViewer outside ViewerProvider");
  return ctx;
}

export function useScopedMerchantId(): string {
  const { isAdmin, scopedMerchantId } = useViewer();
  const { filters } = useFilters();
  return isAdmin ? filters.merchantId : scopedMerchantId;
}

