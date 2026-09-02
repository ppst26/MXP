import { Link } from "react-router-dom";
import type { Payout } from "../../mock/types";
import type { SortDir } from "../../lib/sort";
import { money4 } from "../../lib/money";
import { fmtDT } from "../../lib/bangkok";
import { StatusPill } from "../../lib/StatusPill";
import { BankMark } from "../../lib/BankMark";
import { SortableTh } from "@/components/sortable-table-head";
import { Button } from "@/components/ui/button";

type SortProps = {
  sortKey: string | null;
  sortDir: SortDir;
  onSort: (key: string) => void;
};

export function PayoutTable({
  rows,
  hideBatch,
  showBankFee = true,
  relaxed = false,
  sort,
  onOpen,
  onOpenBatch,
}: {
  rows: Payout[];
  hideBatch?: boolean;
  showBankFee?: boolean;
  relaxed?: boolean;
  sort: SortProps;
  onOpen: (ref: string) => void;
  onOpenBatch?: (id: string) => void;
}) {
  if (!rows.length) {
    return (
      <p className={relaxed ? "py-12 text-center text-sm text-muted-foreground" : "py-8 text-center text-sm text-muted-foreground"}>
        ไม่พบรายการตามตัวกรอง
      </p>
    );
  }
  const { sortKey, sortDir, onSort } = sort;
  return (
    <table className={relaxed ? "data-table relaxed" : "data-table"}>
      <thead>
        <tr>
          <SortableTh label="เวลาสร้าง" sortKey="createdAt" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <SortableTh label="ร้าน" sortKey="merchant" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <SortableTh label="อ้างอิง" sortKey="referenceId" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <SortableTh label="ออเดอร์ร้าน" sortKey="transactionId" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <SortableTh label="ยอด" sortKey="amount" activeKey={sortKey} direction={sortDir} onSort={onSort} className="num" />
          <SortableTh label="ค่าบริการ" sortKey="reservedFee" activeKey={sortKey} direction={sortDir} onSort={onSort} className="num" />
          <SortableTh label="สถานะ" sortKey="status" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          {showBankFee ? (
            <SortableTh label="ค่าโอน" sortKey="bankFee" activeKey={sortKey} direction={sortDir} onSort={onSort} className="num" />
          ) : null}
          <SortableTh label="ผู้รับ" sortKey="recipient" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <SortableTh label="ชื่อที่ธนาคารตอบ" sortKey="accountToName" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          {!hideBatch ? (
            <SortableTh label="ชุด" sortKey="batchId" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          ) : null}
          <SortableTh label="สาเหตุ" sortKey="failureReason" activeKey={sortKey} direction={sortDir} onSort={onSort} />
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => {
          const fee =
            p.status === "COMPLETED" && p.route === "INTERBANK"
              ? "5.00"
              : p.route === "SAME_BANK"
                ? "0.00"
                : (p.status === "PENDING" || p.status === "PROCESSING") && p.route === "INTERBANK"
                  ? "5.00 (ประมาณ)"
                  : "—";
          return (
            <tr key={p.referenceId} className="clickable" onClick={() => onOpen(p.referenceId)}>
              <td>{fmtDT(p.createdAt)}</td>
              <td>
                {p.merchantName} · {p.merchantCode}
              </td>
              <td>
                <span className="font-medium text-primary">{p.referenceId}</span>
              </td>
              <td>{p.transactionId}</td>
              <td className="num text-base font-semibold tabular-nums">{money4(p.amount)}</td>
              <td className="num text-base font-semibold tabular-nums">{money4(p.reservedFee)}</td>
              <td>
                <StatusPill status={p.status} />
              </td>
              {showBankFee ? <td className="num tabular-nums">{fee}</td> : null}
              <td title={`${p.recipientBankName} ${p.recipientBankCode} · ${p.recipientAccountNo}`}>
                <span className="inline-flex items-center gap-2">
                  <BankMark code={p.recipientBankCode} name={p.recipientBankName} />
                  <span className="font-mono tabular-nums">{p.recipientAccountNo}</span>
                </span>
              </td>
              <td className={p.nameMismatch ? "bg-warning/15 max-w-[140px] truncate" : "max-w-[140px] truncate"} title={p.accountToName || undefined}>
                {p.accountToName || "—"}
              </td>
              {!hideBatch && (
                <td>
                  {p.batchId ? (
                    onOpenBatch ? (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenBatch(p.batchId!);
                        }}
                      >
                        {p.batchId.replace("b-", "")}
                      </Button>
                    ) : (
                    <Link
                      className="font-medium text-primary"
                      to={`/payouts/batches/${p.batchId}`}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      {p.batchId.replace("b-", "")}
                    </Link>
                    )
                  ) : p.status === "FAILED" && p.failureReason?.includes("บัญชี") ? (
                    "ไม่เข้าชุด"
                  ) : (
                    "ยังไม่เข้าชุด"
                  )}
                </td>
              )}
              <td>{p.failureReason ? p.failureReason.slice(0, 42) : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
