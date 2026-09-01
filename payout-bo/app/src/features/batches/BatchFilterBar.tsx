import { BATCH_STATUSES, batchLabel } from "../../lib/status";
import { useFilters } from "../../state/FilterProvider";
import { DateRangePicker } from "../../layout/DateRangePicker";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function BatchFilterBar() {
  const { filters, setFilters } = useFilters();
  return (
    <Card size="sm">
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label>จาก–ถึง</Label>
          <DateRangePicker />
        </div>
        <div className="flex flex-col gap-1">
          <Label>สถานะชุด</Label>
          <Select
            value={filters.batchStatus || "all"}
            onValueChange={(v) => setFilters({ batchStatus: v === "all" ? "" : v })}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">ทั้งหมด</SelectItem>
                {BATCH_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {batchLabel(s)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <Label>id / เลขออเดอร์ / package</Label>
          <Input value={filters.batchQ} onChange={(e) => setFilters({ batchQ: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>ค้างเกินเกณฑ์</Label>
          <Select
            value={filters.batchStuck ? "1" : "all"}
            onValueChange={(v) => setFilters({ batchStuck: v === "1" })}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">ทั้งหมด</SelectItem>
                <SelectItem value="1">เฉพาะค้าง / รอคนดู</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
