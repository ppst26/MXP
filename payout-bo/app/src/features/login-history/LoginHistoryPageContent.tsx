import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { listLoginEvents, MOCK_DIRECT_USER } from "../../mock/query";
import { applyPreset, type DatePreset } from "../../lib/bangkok";
import { useAccessMock } from "../../state/use-access-mock";
import { useViewer } from "../../state/use-viewer";
import { useSortedPagination } from "../../hooks/use-sorted-pagination";
import { MerchantPicker } from "../../layout/MerchantPicker";
import { Zone } from "@/components/metric-card";
import { TablePagination } from "@/components/table-pagination";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LoginResult, LoginStage } from "../../mock/types";
import { LoginHistoryTable } from "./LoginHistoryTable";

const loginAccessors = {
  at: (e: ReturnType<typeof listLoginEvents>[number]) => e.at.getTime(),
  user: (e: ReturnType<typeof listLoginEvents>[number]) => e.userId,
  stage: (e: ReturnType<typeof listLoginEvents>[number]) => e.stage,
  result: (e: ReturnType<typeof listLoginEvents>[number]) => e.result,
  reason: (e: ReturnType<typeof listLoginEvents>[number]) => e.reason ?? "",
  ip: (e: ReturnType<typeof listLoginEvents>[number]) => e.ip,
  device: (e: ReturnType<typeof listLoginEvents>[number]) => e.device,
};

const PRESETS: [DatePreset, string][] = [
  ["today", "วันนี้"],
  ["yesterday", "เมื่อวาน"],
  ["d7", "7 วัน"],
  ["d14", "14 วัน"],
  ["d30", "ทั้งเดือน"],
  ["d90", "3 เดือน"],
];

type Props = {
  variant: "admin" | "merchant";
};

export function LoginHistoryPageContent({ variant }: Props) {
  const isAdmin = variant === "admin";
  const { scopedMerchantId } = useViewer();
  const { users, events, merchantName } = useAccessMock();
  const [params, setParams] = useSearchParams();
  const userId = params.get("userId") ?? "";
  const result = (params.get("result") ?? "") as "" | LoginResult;
  const stage = (params.get("stage") ?? "") as "" | LoginStage;
  const [merchantId, setMerchantId] = useState("");
  const [preset, setPreset] = useState<DatePreset>("d7");
  const range = applyPreset(preset);

  const patchParams = (patch: Record<string, string>) => {
    const copy = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) copy.set(k, v);
      else copy.delete(k);
    }
    setParams(copy, { replace: true });
  };

  const filtered = useMemo(
    () =>
      listLoginEvents(events, {
        from: range.from,
        to: range.to,
        merchantId: isAdmin ? merchantId : scopedMerchantId || MOCK_DIRECT_USER,
        userId,
        result,
        stage,
        isAdmin,
      }),
    [events, range.from, range.to, merchantId, userId, result, stage, isAdmin, scopedMerchantId],
  );

  const user = users.find((u) => u.id === userId);
  const resetKey = `${preset}|${merchantId}|${userId}|${result}|${stage}|${filtered.length}`;
  const paging = useSortedPagination(filtered, loginAccessors, resetKey);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="page-header">
          <h1 className="page-title">ประวัติเข้าระบบ</h1>
          <p className="page-description">แยกสองด่าน — รหัสผ่านและ 2FA</p>
          <p className="page-description">
            บันทึกเริ่มต้นตั้งแต่วันที่เปิดใช้ฟีเจอร์นี้ ก่อนหน้านั้นไม่มีข้อมูลเก็บไว้ · ข้อมูลจำลอง
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label className="type-label">ผล</Label>
            <Select value={result || "all"} onValueChange={(v) => patchParams({ result: v === "all" ? "" : v })}>
              <SelectTrigger size="sm" className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">ทั้งหมด</SelectItem>
                  <SelectItem value="success">สำเร็จ</SelectItem>
                  <SelectItem value="failed">ล้มเหลว</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="type-label">ด่าน</Label>
            <Select value={stage || "all"} onValueChange={(v) => patchParams({ stage: v === "all" ? "" : v })}>
              <SelectTrigger size="sm" className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">ทั้งหมด</SelectItem>
                  <SelectItem value="password">รหัสผ่าน</SelectItem>
                  <SelectItem value="2fa">2FA</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
      </header>

      <section className="flex flex-col gap-3" aria-label="ตัวกรอง">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            {isAdmin ? (
              <MerchantPicker
                merchantId={merchantId}
                onChange={setMerchantId}
              />
            ) : (
              <div className="flex flex-col gap-1">
                <Label className="type-label">ร้าน</Label>
                <p className="text-sm">{merchantName(MOCK_DIRECT_USER)}</p>
              </div>
            )}
            {userId ? (
              <Button type="button" variant="outline" size="sm" onClick={() => patchParams({ userId: "" })}>
                กรอง: {user?.username ?? userId} · ล้าง
              </Button>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <Label className="type-label">ช่วง</Label>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={preset}
              onValueChange={(v) => {
                if (v) setPreset(v as DatePreset);
              }}
            >
              {PRESETS.map(([id, t]) => (
                <ToggleGroupItem key={id} value={id}>
                  {t}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
      </section>

      <Zone title="รายการเข้าสู่ระบบ">
        <div className="overflow-auto rounded-sm surface-nested ring-1 ring-foreground/5">
          <LoginHistoryTable
            rows={paging.slice}
            users={users}
            isAdmin={isAdmin}
            shopName={merchantName}
            sort={{ sortKey: paging.sortKey, sortDir: paging.sortDir, onSort: paging.requestSort }}
          />
        </div>
        <TablePagination
          page={paging.page}
          pages={paging.pages}
          pageSize={paging.pageSize}
          total={paging.total}
          onPageChange={paging.setPage}
          onPageSizeChange={paging.setPageSize}
        />
      </Zone>
    </div>
  );
}
