import { Link, useLocation } from "react-router-dom";
import { BanknoteIcon } from "lucide-react";
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
import { useViewer } from "../state/ViewerProvider";

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

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
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
                <SidebarMenuButton asChild isActive={overviewOn || payoutsOn || batchesOn}>
                  <Link to="/payouts/overview">
                    <BanknoteIcon />
                    <span>โอนออก</span>
                  </Link>
                </SidebarMenuButton>
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton asChild isActive={overviewOn}>
                      <Link to="/payouts/overview">ภาพรวม</Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton asChild isActive={payoutsOn}>
                      <Link to="/payouts">รายการใบถอน</Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  {isAdmin ? (
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton asChild isActive={batchesOn}>
                        <Link to="/payouts/batches">ชุดโอน</Link>
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
