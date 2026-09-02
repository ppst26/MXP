import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  BanknoteIcon,
  BookOpenIcon,
  ChevronDown,
  GitCompareIcon,
  HistoryIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  LayersIcon,
  ListIcon,
  LogOutIcon,
  PercentIcon,
  ShieldIcon,
  StoreIcon,
  UsersIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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
import { cn } from "@/lib/utils";
import { useViewer } from "../state/use-viewer";

export function AppSidebar() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const { isAdmin, logout } = useViewer();
  const payoutsOn =
    pathname === "/payouts" ||
    (pathname.startsWith("/payouts/") &&
      !pathname.startsWith("/payouts/overview") &&
      !pathname.startsWith("/payouts/batches") &&
      !pathname.startsWith("/payouts/rates") &&
      !pathname.startsWith("/payouts/books") &&
      !pathname.startsWith("/payouts/recon") &&
      !pathname.startsWith("/payouts/liquidity"));
  const batchesOn = pathname.startsWith("/payouts/batches");
  const overviewOn = pathname.startsWith("/payouts/overview") || pathname === "/";
  const payoutGroupOn = overviewOn || payoutsOn || batchesOn;
  const ratesOn = pathname.startsWith("/payouts/rates");
  const booksOn = pathname.startsWith("/payouts/books");
  const reconOn = pathname.startsWith("/payouts/recon");
  const liquidityOn = pathname.startsWith("/payouts/liquidity");
  const shopsOn = pathname.startsWith("/shops");
  const adminsOn = pathname.startsWith("/admins");
  const usersOn = pathname.startsWith("/users");
  const loginHistoryOn = pathname.startsWith("/login-history");
  const [menuOpen, setMenuOpen] = useState(payoutGroupOn);

  useEffect(() => {
    if (payoutGroupOn) setMenuOpen(true);
  }, [payoutGroupOn]);

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
                <SidebarMenuButton
                  isActive={payoutGroupOn}
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  <BanknoteIcon />
                  <span>โอนออก</span>
                  <ChevronDown
                    className={cn(
                      "ml-auto size-4 shrink-0 opacity-60 transition-transform duration-200 ease-out",
                      menuOpen && "rotate-180",
                    )}
                  />
                </SidebarMenuButton>
                <div
                  className={cn(
                    "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
                    menuOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                  )}
                >
                  <div className="overflow-hidden">
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
                  </div>
                </div>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {isAdmin ? (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>เรตถอน</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={ratesOn}>
                      <Link to="/payouts/rates">
                        <PercentIcon />
                        <span>อัตราและส่วนต่าง</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>การเงินถอน</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={booksOn}>
                      <Link to="/payouts/books">
                        <BookOpenIcon />
                        <span>สมุดร้าน</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={reconOn}>
                      <Link to="/payouts/recon">
                        <GitCompareIcon />
                        <span>กระทบยอดขาออก</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>สภาพคล่อง</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={liquidityOn}>
                      <Link to="/payouts/liquidity">
                        <LandmarkIcon />
                        <span>บัญชีจ่ายและสำรอง</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        ) : null}
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarGroupLabel>เฟสถัดไป</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isAdmin ? (
                <>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={shopsOn}>
                      <Link to="/shops">
                        <StoreIcon />
                        <span>จัดการร้านค้า</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={adminsOn}>
                      <Link to="/admins">
                        <ShieldIcon />
                        <span>แอดมิน</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </>
              ) : (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={usersOn}>
                    <Link to="/users">
                      <UsersIcon />
                      <span>ผู้ใช้</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={loginHistoryOn}>
                  <Link to="/login-history">
                    <HistoryIcon />
                    <span>ประวัติเข้าระบบ</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton disabled>
                  <span>รับเงิน</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {isAdmin ? null : (
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>
                    <span>สมุดบัญชี</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => {
                logout();
                nav("/login", { replace: true });
              }}
            >
              <LogOutIcon />
              <span>ออกจากระบบ</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
