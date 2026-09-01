import { Outlet } from "react-router-dom";
import { db } from "../mock/seed";
import { fmtDT } from "../lib/bangkok";
import { useViewer } from "../state/ViewerProvider";
import type { Role } from "../state/ViewerProvider";
import { AppSidebar } from "./AppSidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export function Shell() {
  const { role, isAdmin, demo, setRole, setDemo } = useViewer();
  const demoCount = [demo.sendOff, demo.staleBalance, demo.noSource, demo.queueExceeds].filter(Boolean).length;

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <span className="truncate text-xs text-muted-foreground">
            MaxPay BO · mock · ข้อมูลจำลอง
          </span>
          <div className="ml-auto flex items-center gap-2">
            {isAdmin ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    จำลอง
                    {demoCount ? <Badge variant="secondary">{demoCount}</Badge> : null}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>สถานะจำลอง · ไม่ใช่ตัวกรองจริง</DropdownMenuLabel>
                  <DropdownMenuGroup>
                    <DropdownMenuCheckboxItem checked={demo.sendOff} onCheckedChange={(v) => setDemo({ sendOff: !!v })}>
                      send ปิด
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={demo.staleBalance}
                      onCheckedChange={(v) => setDemo({ staleBalance: !!v })}
                    >
                      ยอดเก่า
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={demo.noSource} onCheckedChange={(v) => setDemo({ noSource: !!v })}>
                      ไม่มีบัญชีต้นทาง
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={demo.queueExceeds}
                      onCheckedChange={(v) => setDemo({ queueExceeds: !!v })}
                    >
                      ยอดไม่พอคิว
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
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
            <span className="hidden text-xs text-muted-foreground lg:inline">
              {fmtDT(db.now)} น. · ใบ {db.payouts.length} · ชุด {db.batches.length}
            </span>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pb-12">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
