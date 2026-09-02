import type { ReactNode } from "react";
import { useViewer } from "../state/use-viewer";

export function AdminOnly({
  children,
  message = "หน้าชุดโอนสำหรับแพลตฟอร์มแอดมินเท่านั้น · ร้านไม่เห็นยอดรวมทั้งชุด",
}: {
  children: ReactNode;
  message?: string;
}) {
  const { isAdmin } = useViewer();
  if (!isAdmin) {
    return (
      <div>
        <h1 className="page-title">404</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    );
  }
  return children;
}
