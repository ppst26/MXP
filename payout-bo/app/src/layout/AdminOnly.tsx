import type { ReactNode } from "react";
import { useViewer } from "../state/use-viewer";

export function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useViewer();
  if (!isAdmin) {
    return (
      <div>
        <h1 className="font-heading text-xl tracking-tight">404</h1>
        <p className="text-sm text-muted-foreground">หน้าชุดโอนสำหรับแพลตฟอร์มแอดมินเท่านั้น · ร้านไม่เห็นยอดรวมทั้งชุด</p>
      </div>
    );
  }
  return children;
}
