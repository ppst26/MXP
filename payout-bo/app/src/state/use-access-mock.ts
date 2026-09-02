import { useContext } from "react";
import { AccessMockContext, type AccessMockValue, type CreateBoUserInput } from "./access-mock-context";

export type { AccessMockValue, CreateBoUserInput };

export function useAccessMock(): AccessMockValue {
  const ctx = useContext(AccessMockContext);
  if (!ctx) throw new Error("useAccessMock outside AccessMockProvider");
  return ctx;
}
