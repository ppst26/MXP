import { Link } from "react-router-dom";
import type { Payout } from "../../mock/types";
import { money4 } from "../../lib/money";
import { fmtDT } from "../../lib/bangkok";
import { RoutePill, StatusPill } from "../../lib/StatusPill";
import { Button } from "@/components/ui/button";

export function PayoutTable({
  rows,
  hideBatch,
  showBankFee = true,
  onOpen,
  onOpenBatch,
}: {
  rows: Payout[];
  hideBatch?: boolean;
  showBankFee?: boolean;
  onOpen: (ref: string) => void;
  onOpenBatch?: (id: string) => void;
}) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">ไม่พบรายการตามตัวกรอง</p>;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>เวลาสร้าง</th>
          <th>ร้าน</th>
          <th>อ้างอิง</th>
          <th>ออเดอร์ร้าน</th>
          <th className="num">ยอด</th>
          <th className="num">ค่าบริการ</th>
          <th>สถานะ</th>
          <th>เส้นทาง</th>
          {showBankFee ? <th className="num">ค่าโอน</th> : null}
          <th>ผู้รับ</th>
          <th>ชื่อที่ธนาคารตอบ</th>
          {!hideBatch && <th>ชุด</th>}
          <th>สาเหตุ</th>
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
              <td className="num">{money4(p.amount)}</td>
              <td className="num">{money4(p.reservedFee)}</td>
              <td>
                <StatusPill status={p.status} />
              </td>
              <td>
                <RoutePill route={p.route} />
              </td>
              {showBankFee ? <td className="num">{fee}</td> : null}
              <td>
                {p.recipientBankName} {p.recipientBankCode} · {p.recipientAccountNo} · {p.recipientName}
              </td>
              <td className={p.nameMismatch ? "bg-warning/15" : undefined}>{p.accountToName || "—"}</td>
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
