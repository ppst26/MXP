import { AlertTriangle, Clock, Plus, Wallet } from "lucide-react";
import type { Payout, PayoutStatus } from "../../mock/types";
import { money } from "../../lib/money";
import { NOW } from "../../lib/bangkok";
import { sumAmt } from "../../mock/query";
import { cn } from "@/lib/utils";
import { FocusRow } from "./FocusRow";

const iconProps = { className: "size-4", strokeWidth: 1.8 } as const;

export function MerchantFollowUp({
  pending,
  processing,
  review,
  held,
  showHeld,
  onGoList,
}: {
  pending: Payout[];
  processing: Payout[];
  review: Payout[];
  held: number;
  showHeld: boolean;
  onGoList: (statuses: PayoutStatus[]) => void;
}) {
  const oldest = pending.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  const oldestMin = oldest ? Math.round((NOW.getTime() - oldest.createdAt.getTime()) / 60000) : 0;
  const unconf = processing.filter((p) => (p.bankBulkOrderId || p.bankOrderId) && !p.confirmedAt);
  const conf = processing.filter((p) => p.confirmedAt);
  const openCount = pending.length + processing.length + review.length;

  const processingSub =
    (unconf.length ? `ห้ามส่งซ้ำ ${unconf.length} ใบ` : "กำลังโอน รอยืนยันจากธนาคาร") +
    (conf.length ? ` · รอผล ${conf.length} ใบ` : "");
  const pendingSub = money(sumAmt(pending)) + (oldest ? ` · เก่าสุด ${oldestMin} น.` : " · ไม่มีใบค้าง");

  const rows = [
    {
      key: "pending",
      title: "รอส่งเข้าธนาคาร",
      sub: pendingSub,
      count: pending.length,
      tone: pending.length ? ("default" as const) : ("quiet" as const),
      icon: <Plus {...iconProps} />,
      onClick: () => onGoList(["PENDING"]),
    },
    {
      key: "processing",
      title: "กำลังส่ง รอยืนยันจากธนาคาร",
      sub: processingSub,
      count: processing.length,
      tone: unconf.length ? ("warn" as const) : processing.length ? ("default" as const) : ("quiet" as const),
      icon: <AlertTriangle {...iconProps} />,
      onClick: () => onGoList(["PROCESSING"]),
    },
    {
      key: "review",
      title: "รายการต้องตรวจสอบ",
      sub: review.length ? money(sumAmt(review)) : "ไม่มีใบค้างตรวจ",
      count: review.length,
      tone: review.length ? ("alert" as const) : ("quiet" as const),
      icon: <Clock {...iconProps} />,
      onClick: () => onGoList(["NEEDS_REVIEW"]),
    },
    ...(showHeld
      ? [
          {
            key: "held",
            title: "เงินที่กันไว้",
            sub: `PENDING + PROCESSING · ${openCount} รายการที่ยังไม่จบ`,
            count: `฿ ${money(held)}`,
            tone: "quiet" as const,
            icon: <Wallet {...iconProps} />,
            onClick: () => onGoList(["PENDING", "PROCESSING"]),
          },
        ]
      : []),
  ];

  return (
    <div className="flex h-full min-h-[22rem] flex-col p-5">
      <div className="shrink-0">
        <h2 className="type-section">ต้องติดตามตอนนี้</h2>
        <p className="type-label mt-1">เฉพาะรายการโอนของร้าน · ไม่รวมชุดโอนของแพลตฟอร์ม</p>
      </div>
      <div
        className={cn(
          "mt-4 grid min-h-0 flex-1 gap-2",
          rows.length === 4 ? "grid-rows-4" : "grid-rows-3",
        )}
      >
        {rows.map((row) => (
          <FocusRow
            key={row.key}
            title={row.title}
            sub={row.sub}
            count={row.count}
            tone={row.tone}
            icon={row.icon}
            onClick={row.onClick}
          />
        ))}
      </div>
      <p className="type-label mt-4 shrink-0">
        สแนปชอตคิว ณ ตอนนี้ · ไม่ตามวันที่เลือก · poll 15 วินาที
      </p>
    </div>
  );
}
