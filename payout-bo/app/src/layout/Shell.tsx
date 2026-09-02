import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useFilters } from "../state/FilterProvider";
import { useViewer } from "../state/use-viewer";
import type { Role } from "../state/use-viewer";
import { AppSidebar } from "./AppSidebar";
import { AppBreadcrumb } from "./AppBreadcrumb";
import { HeaderClock } from "./HeaderClock";
import { NotificationBell } from "../features/notifications/NotificationBell";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export function Shell() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { role, setRole } = useViewer();
  const { setFilters } = useFilters();

  const onRoleChange = (next: Role) => {
    setRole(next);
    if (next === "merchant") {
      setFilters({ merchantId: "", listPage: 1 });
      if (
        pathname.startsWith("/payouts/batches") ||
        pathname.startsWith("/payouts/rates") ||
        pathname.startsWith("/payouts/books") ||
        pathname.startsWith("/payouts/recon") ||
        pathname.startsWith("/payouts/liquidity") ||
        pathname.startsWith("/shops") ||
        pathname.startsWith("/admins")
      ) {
        nav("/payouts/overview");
      }
    }
  };

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-h-svh">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b bg-background px-4">
          <AppBreadcrumb />
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
            <Select value={role} onValueChange={(v) => onRoleChange(v as Role)}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="admin">แพลตฟอร์มแอดมิน</SelectItem>
                  <SelectItem value="merchant">ร้าน Acme (DIRECT)</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <HeaderClock />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pb-12">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
