import { useMemo, useState, type ReactNode } from "react";
import type { HouseDemo } from "../mock/query";
import { MOCK_DIRECT_USER } from "../mock/query";
import { ViewerContext, type Role, type ViewerContextValue } from "./viewer-context";

export type { Role };

const demoOff: HouseDemo = {
  sendOff: false,
  staleBalance: false,
  noSource: false,
  queueExceeds: false,
};

export function ViewerProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>("admin");
  const [demo, setDemoState] = useState<HouseDemo>(demoOff);
  const value = useMemo<ViewerContextValue>(
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
