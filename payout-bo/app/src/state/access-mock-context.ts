import { createContext } from "react";
import type { BoUser, BoUserRole, BoUserStatus, LoginEvent } from "../mock/types";

export type CreateBoUserInput = {
  username: string;
  displayName: string;
  merchantId: string | null;
  role: BoUserRole;
};

export type AccessMockValue = {
  users: BoUser[];
  events: LoginEvent[];
  flash: string | null;
  clearFlash: () => void;
  merchantName: (merchantId: string) => string;
  createUser: (input: CreateBoUserInput) => { ok: true; user: BoUser } | { ok: false; error: string };
  setStatus: (id: string, status: BoUserStatus) => void;
  resetPassword: (id: string) => string | null;
  renameShop: (merchantId: string, name: string) => { ok: true } | { ok: false; error: string };
  renameDisplayName: (id: string, displayName: string) => { ok: true } | { ok: false; error: string };
};

export const AccessMockContext = createContext<AccessMockValue | null>(null);
