import { useFilters } from "../../state/FilterProvider";
import { PAYOUT_STATUSES, payoutLabel } from "../../lib/status";
import type { PayoutStatus } from "../../mock/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function PayoutFilterBar() {
  const { filters, setFilters } = useFilters();
  const toggle = (s: PayoutStatus) => {
    const has = filters.statuses.includes(s);
    setFilters({
      statuses: has ? filters.statuses.filter((x) => x !== s) : [...filters.statuses, s],
      listPage: 1,
    });
  };
  return (
    <div className="flex flex-wrap items-end gap-3">
      {filters.batchId ? (
        <div className="flex flex-col gap-1">
          <Label>ชุด</Label>
          <Button type="button" variant="outline" size="sm" onClick={() => setFilters({ batchId: "", listPage: 1 })}>
            {filters.batchId} · ล้าง
          </Button>
        </div>
      ) : null}
      <div className="flex min-w-48 flex-1 flex-col gap-1">
        <Label>อ้างอิง / ออเดอร์ร้าน (ตรงค่า)</Label>
        <Input
          value={filters.q}
          placeholder="referenceId หรือ transactionId"
          onChange={(e) => setFilters({ q: e.target.value, listPage: 1 })}
        />
      </div>
      <div className="flex min-w-40 flex-1 flex-col gap-1">
        <Label>เลขบัญชีผู้รับ</Label>
        <Input
          value={filters.recipientAccount}
          onChange={(e) => setFilters({ recipientAccount: e.target.value, listPage: 1 })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label>ชื่อไม่ตรง</Label>
        <Select
          value={filters.nameMismatch ? "1" : "all"}
          onValueChange={(v) => setFilters({ nameMismatch: v === "1", listPage: 1 })}
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">ทั้งหมด</SelectItem>
              <SelectItem value="1">เฉพาะที่ไม่ตรง</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="flex min-w-64 flex-1 flex-col gap-1">
        <Label>สถานะใบ (เลือกได้หลายค่า)</Label>
        <div className="flex flex-wrap gap-3 pt-1">
          {PAYOUT_STATUSES.map((s) => (
            <label key={s} className="flex items-center gap-2 text-xs">
              <Checkbox checked={filters.statuses.includes(s)} onCheckedChange={() => toggle(s)} />
              {payoutLabel(s)}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
