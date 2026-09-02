import { Link } from "react-router-dom";
import type { ShopUserSummary } from "../../mock/query";
import type { SortDir } from "../../lib/sort";
import { fmtDTThai } from "../../lib/bangkok";
import { money } from "../../lib/money";
import { SortableTh } from "@/components/sortable-table-head";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type SortProps = {
  sortKey: string | null;
  sortDir: SortDir;
  onSort: (key: string) => void;
};

type Props = {
  rows: ShopUserSummary[];
  sort: SortProps;
  onOpen: (merchantId: string) => void;
  onRename: (merchantId: string) => void;
  onPending: (merchantId: string) => void;
};

export function ShopTable({ rows, sort, onOpen, onRename, onPending }: Props) {
  if (!rows.length) {
    return <p className="py-12 text-center text-sm text-muted-foreground">ไม่พบร้านตามตัวกรอง</p>;
  }

  const { sortKey, sortDir, onSort } = sort;

  return (
    <table className="data-table relaxed">
      <thead>
        <tr>
          <SortableTh label="ร้านค้า" sortKey="name" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <SortableTh label="ถอนได้ตอนนี้" sortKey="operate" activeKey={sortKey} direction={sortDir} onSort={onSort} className="num" />
          <SortableTh label="รอทำรายการ" sortKey="pendingAmount" activeKey={sortKey} direction={sortDir} onSort={onSort} className="num" />
          <SortableTh label="บัญชี" sortKey="accountCount" activeKey={sortKey} direction={sortDir} onSort={onSort} className="num" />
          <SortableTh label="เข้าสู่ล่าสุด" sortKey="lastLoginAt" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <th>การทำงาน</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.merchantId} className="clickable" onClick={() => onOpen(row.merchantId)}>
            <td>
              <Link
                className="font-medium text-primary"
                to={`/shops/${row.merchantId}`}
                onClick={(e) => e.stopPropagation()}
              >
                {row.name}
              </Link>
              <div className="text-xs text-muted-foreground">{row.code}</div>
            </td>
            <td className={cn("num text-base font-semibold tabular-nums", row.operate <= 0 && "text-warning")}>
              ฿ {money(row.operate)}
            </td>
            <td className="num">
              {row.pendingCount > 0 ? (
                <button
                  type="button"
                  className="inline-flex flex-col items-end text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPending(row.merchantId);
                  }}
                >
                  <span className="text-base font-semibold tabular-nums">฿ {money(row.pendingAmount)}</span>
                  <span className="text-xs text-muted-foreground">{row.pendingCount} รายการ</span>
                </button>
              ) : (
                <div className="text-muted-foreground">
                  <div className="text-base font-semibold tabular-nums">฿ {money(0)}</div>
                  <div className="text-xs">0 รายการ</div>
                </div>
              )}
            </td>
            <td className="num text-base font-semibold tabular-nums">
              {row.accountCount}
              <div className="text-xs font-normal text-muted-foreground">แอดมินร้าน {row.adminCount}</div>
            </td>
            <td>{row.lastLoginAt ? fmtDTThai(row.lastLoginAt) : "—"}</td>
            <td>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onRename(row.merchantId);
                }}
              >
                เปลี่ยนชื่อร้าน
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
