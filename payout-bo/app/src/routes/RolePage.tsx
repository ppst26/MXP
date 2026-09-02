import type { ReactNode } from "react";
import { useViewer } from "../state/use-viewer";

export function RolePage({
  admin,
  merchant,
}: {
  admin: ReactNode;
  merchant: ReactNode;
}) {
  const { isAdmin } = useViewer();
  return isAdmin ? admin : merchant;
}
