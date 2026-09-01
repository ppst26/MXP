import { Link, useLocation } from "react-router-dom";
import {
  BanknoteIcon,
  ChevronDown,
  LayoutDashboardIcon,
  LayersIcon,
  ListIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { useViewer } from "../state/use-viewer";

export function AppSidebar() {
  const { pathname } = useLocation();
  const { isAdmin } = useViewer();
  const payoutsOn =
    pathname === "/payouts" ||
    (pathname.startsWith("/payouts/") &&
      !pathname.startsWith("/payouts/overview") &&
      !pathname.startsWith("/payouts/batches"));
  const batchesOn = pathname.startsWith("/payouts/batches");
  const overviewOn = pathname.startsWith("/payouts/overview") || pathname === "/";
  const payoutGroupOn = overviewOn || payoutsOn || batchesOn;

  return (
    <Sidebar collapsible="none">
      <SidebarHeader className="flex h-16 w-full shrink-0 items-center border-b border-sidebar-border bg-sidebar px-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/payouts/overview">
                <BanknoteIcon />
                <span>MaxPay BO</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>โอนออก</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={payoutGroupOn}>
                  <Link to="/payouts/overview">
                    <BanknoteIcon />
                    <span>โอนออก</span>
                    <ChevronDown className="ml-auto size-4 shrink-0 opacity-60" />
                  </Link>
                </SidebarMenuButton>
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton asChild isActive={overviewOn}>
                      <Link to="/payouts/overview">
                        <LayoutDashboardIcon />
                        <span>ภาพรวม</span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton asChild isActive={payoutsOn}>
                      <Link to="/payouts">
                        <ListIcon />
                        <span>รายการใบถอน</span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  {isAdmin ? (
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton asChild isActive={batchesOn}>
                        <Link to="/payouts/batches">
                          <LayersIcon />
                          <span>ชุดโอน</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ) : null}
                </SidebarMenuSub>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarGroupLabel>เฟสถัดไป</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton disabled>
                  <span>รับเงิน</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton disabled>
                  <span>สมุดบัญชี</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
