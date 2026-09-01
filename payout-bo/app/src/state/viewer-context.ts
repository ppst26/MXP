import { createContext } from "react";
import type { HouseDemo } from "../mock/query";

export type Role = "admin" | "merchant";

export type ViewerContextValue = {
  role: Role;
  isAdmin: boolean;
  demo: HouseDemo;
  scopedMerchantId: string;
  setRole: (role: Role) => void;
  setDemo: (patch: Partial<HouseDemo>) => void;
};

export const ViewerContext = createContext<ViewerContextValue | null>(null);
