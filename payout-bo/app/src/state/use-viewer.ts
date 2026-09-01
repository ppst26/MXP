import { useContext } from "react";
import { useFilters } from "./FilterProvider";
import { ViewerContext, type Role } from "./viewer-context";

export type { Role };

export function useViewer() {
  const ctx = useContext(ViewerContext);
  if (!ctx) throw new Error("useViewer outside ViewerProvider");
  return ctx;
}

export function useScopedMerchantId(): string {
  const { isAdmin, scopedMerchantId } = useViewer();
  const { filters } = useFilters();
  return isAdmin ? filters.merchantId : scopedMerchantId;
}
