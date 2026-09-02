import { useState, type ReactNode } from "react";
import { AlertTriangle, Clock, Layers, List, Plus, Wallet } from "lucide-react";
import type { Batch, Payout, SourceAccount } from "../../mock/types";
import { money } from "../../lib/money";
import { BALANCE_MAX_AGE_MS, sumAmt } from "../../mock/query";
import { NOW } from "../../lib/bangkok";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { STUCK_BATCH_LABEL, StuckBatchHeading } from "../batches/StuckBatchHeading";
import { FocusRow } from "./FocusRow";
import { cn } from "@/lib/utils";

type DotTone = "ok" | "warn" | "bad";

function StatusDot({ tone, pulse }: { tone: DotTone; pulse?: boolean }) {
  return (
    <span className="relative inline-flex size-1.5 shrink-0">
      {pulse && tone === "ok" ? (
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-50" />
      ) : null}
      <span
        className={cn(
          "relative inline-flex size-1.5 rounded-full",
          tone === "ok" && "bg-success shadow-[0_0_0_3px_rgba(39,166,68,0.12)]",
          tone === "warn" && "bg-warning",
          tone === "bad" && "bg-destructive",
        )}
      />
    </span>
  );
}

function StatusItem({ label, tone }: { label: string; tone: DotTone }) {
  return (
    <span className="type-label inline-flex items-center gap-1.5">
      {label}
      <StatusDot tone={tone} />
    </span>
  );
}

function accountTone(source: SourceAccount): DotTone {
  if (source.status !== "ACTIVE") return "bad";
  if (source.tier !== "OUTBOUND") return "warn";
  return "ok";
}

function eyebrowTone(source: SourceAccount): DotTone {
  if (!source.payoutEnabled || !source.sendEnabled) return "bad";
  return accountTone(source);
}

function SourceHeroLeft({ source }: { source: SourceAccount | null }) {
  if (!source) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <div className="type-section inline-flex items-center gap-2 text-muted-foreground">
          <StatusDot tone="bad" />
          บัญชีต้นทางพร้อมโอน
        </div>
        <Alert variant="destructive">
          <AlertDescription>ยังไม่ตั้งบัญชีต้นทาง — ห้ามเดาบัญชีจากร้านหรือจาก config อื่น</AlertDescription>
        </Alert>
      </div>
    );
  }

  const stale = NOW.getTime() - source.bankBalanceAt.getTime() > BALANCE_MAX_AGE_MS;
  const ageMin = Math.round((NOW.getTime() - source.bankBalanceAt.getTime()) / 60000);
  const lowBalance = source.bankBalance < source.minBalance;

  return (
    <div className="flex h-full min-h-0 flex-col p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="type-section inline-flex items-center gap-2 text-muted-foreground">
            <StatusDot tone={eyebrowTone(source)} pulse={eyebrowTone(source) === "ok"} />
            บัญชีต้นทางพร้อมโอน
          </div>
          <div className="type-label mt-1">
            {stale ? (
              <span className="text-warning">เก่า {ageMin} น. ห้ามอ่านว่าพอจ่าย</span>
            ) : (
              <span>รีเฟรช {ageMin} นาทีที่แล้ว</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusItem label="รับคำสั่ง" tone={source.payoutEnabled ? "ok" : "bad"} />
          <StatusItem label="ส่งเงิน" tone={source.sendEnabled ? "ok" : "bad"} />
          <StatusItem label="บัญชี" tone={accountTone(source)} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="text-2xl">{source.bankName}</p>
          <p className="type-display mt-1.5 tracking-tight">{source.accountNo}</p>
          <div className="type-label mt-2 space-y-0.5">
            {source.tier !== "OUTBOUND" ? (
              <div className="text-warning">tier {source.tier} · เตือน: ไม่ใช่ OUTBOUND</div>
            ) : null}
            {source.status !== "ACTIVE" ? <div className="text-destructive">สถานะบัญชี {source.status}</div> : null}
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className={cn("type-hero-balance", lowBalance && "text-destructive")}>
            ฿ {money(source.bankBalance)}
            <span className="ml-1 text-sm font-medium tracking-normal text-muted-foreground">THB</span>
          </div>
          <div className="mt-1.5 text-xs text-muted-foreground">{source.accountName}</div>
        </div>
      </div>
    </div>
  );
}

function SourceStatCard({
  label,
  value,
  hint,
  danger,
}: {
  label: string;
  value: ReactNode;
  hint: ReactNode;
  danger?: boolean;
}) {
  return (
    <Card size="sm" className="h-full min-w-0">
      <div className="flex h-full flex-col gap-1.5 px-4 py-3">
        <div className="type-stat-label">{label}</div>
        <div className={cn("type-stat-value", danger && "text-destructive")}>{value}</div>
        <div className="type-label leading-snug">{hint}</div>
      </div>
    </Card>
  );
}

function SourceStatRow({
  source,
  held,
  openCount,
}: {
  source: SourceAccount | null;
  held: number;
  openCount: number;
}) {
  if (!source) return null;
  const amountFull = source.dailyAmountCap > 0 && source.dailyAmountUsed >= source.dailyAmountCap;
  const txnFull = source.dailyTxnCap > 0 && source.dailyTxnUsed >= source.dailyTxnCap;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <SourceStatCard
        label="คิวที่กันไว้"
        value={`฿ ${money(held)}`}
        hint={`${openCount} รายการที่ยังไม่จบ · PENDING + PROCESSING`}
      />
      <SourceStatCard
        label="เพดานโอนวันนี้"
        value={
          <>
            ฿ {money(source.dailyAmountUsed)}
            <span className="ml-1 text-sm font-medium tracking-normal text-muted-foreground">
              / ฿ {money(source.dailyAmountCap)}
            </span>
          </>
        }
        hint={`สำรอง ${money(source.minBalance)}`}
        danger={amountFull}
      />
      <SourceStatCard
        label="เพดานรายการ"
        value={
          <>
            {source.dailyTxnUsed}
            <span className="ml-1 text-sm font-medium tracking-normal text-muted-foreground">
              / {source.dailyTxnCap}
            </span>
          </>
        }
        hint="ใบที่ส่งวันนี้"
        danger={txnFull}
      />
    </div>
  );
}

type QueueTab = "payouts" | "batches";

function QueueTabButton({
  active,
  onClick,
  icon,
  label,
  trailing,
  ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  trailing?: ReactNode;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "active border-foreground/15 bg-foreground/8 text-foreground shadow-sm"
          : "border-transparent text-muted-foreground hover:border-foreground/10 hover:bg-foreground/4 hover:text-foreground",
      )}
    >
      {icon}
      <span>{label}</span>
      {trailing}
    </button>
  );
}

function PayoutFocusList({
  pending,
  processing,
  review,
  held,
  onGoList,
}: {
  pending: Payout[];
  processing: Payout[];
  review: Payout[];
  held: number;
  onGoList: (statuses: string[]) => void;
}) {
  const oldest = pending.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  const oldestMin = oldest ? Math.round((NOW.getTime() - oldest.createdAt.getTime()) / 60000) : 0;
  const unconf = processing.filter((p) => (p.bankBulkOrderId || p.bankOrderId) && !p.confirmedAt);
  const conf = processing.filter((p) => p.confirmedAt);
  const openCount = pending.length + processing.length + review.length;

  const processingSub =
    (unconf.length ? `ห้ามส่งซ้ำ ${unconf.length}` : "ในชุด/กำลังโอน") + (conf.length ? ` · รอผล ${conf.length}` : "");
  const pendingSub = money(sumAmt(pending)) + (oldest ? ` · เก่าสุด ${oldestMin} น.` : " · ไม่มีใบค้าง");

  return (
    <div className="grid h-full min-h-0 grid-rows-4 gap-2">
      <FocusRow
        title="รอส่งเข้าธนาคาร"
        sub={pendingSub}
        count={pending.length}
        tone={pending.length ? "default" : "quiet"}
        icon={<Plus className="size-3.5" strokeWidth={1.8} />}
        onClick={() => onGoList(["PENDING"])}
      />
      <FocusRow
        title="กำลังส่ง รอยืนยันจากธนาคาร"
        sub={processingSub}
        count={processing.length}
        tone={unconf.length ? "warn" : processing.length ? "default" : "quiet"}
        icon={<AlertTriangle className="size-3.5" strokeWidth={1.8} />}
        onClick={() => onGoList(["PROCESSING"])}
      />
      <FocusRow
        title="รายการต้องตรวจสอบ"
        sub={review.length ? money(sumAmt(review)) : "ไม่มีใบค้างตรวจ"}
        count={review.length}
        tone={review.length ? "alert" : "quiet"}
        icon={<Clock className="size-3.5" strokeWidth={1.8} />}
        onClick={() => onGoList(["NEEDS_REVIEW"])}
      />
      <FocusRow
        title="เงินที่กันไว้"
        sub={`PENDING + PROCESSING · ผลรวมใบ ไม่ใช่สมุดร้าน · ${openCount} รายการที่ยังไม่จบ`}
        count={`฿ ${money(held)}`}
        tone="quiet"
        icon={<Wallet className="size-3.5" strokeWidth={1.8} />}
        onClick={() => onGoList(["PENDING", "PROCESSING"])}
      />
    </div>
  );
}

function needsLookSub(needsLook: Batch[]): string {
  if (!needsLook.length) return "ไม่มี";
  const review = needsLook.filter((b) => b.status === "NEEDS_REVIEW").length;
  const stuck = needsLook.filter((b) => b.stuck).length;
  const parts: string[] = [];
  if (review) parts.push(`รอตรวจ ${review}`);
  if (stuck) parts.push(`${STUCK_BATCH_LABEL} ${stuck}`);
  return parts.join(" · ");
}

function BatchFocusList({
  open,
  inFlight,
  needsLook,
  onGoBatches,
}: {
  open: Batch[];
  inFlight: Batch[];
  needsLook: Batch[];
  onGoBatches: (patch: { batchStatus?: string; batchStuck?: boolean }) => void;
}) {
  const items = open.reduce((s, b) => s + b.itemCount, 0);

  return (
    <div className="grid h-full min-h-0 flex-1 grid-rows-3 gap-2">
      <FocusRow
        title="ชุดรอส่ง"
        sub={open.length ? `${items} ใบในชุด` : "ไม่มี"}
        count={open.length}
        tone={open.length ? "default" : "quiet"}
        icon={<Layers className="size-3.5" strokeWidth={1.8} />}
        onClick={() => onGoBatches({ batchStatus: "PENDING" })}
      />
      <FocusRow
        title="ชุดระหว่างทาง"
        sub={inFlight.length ? "ห้ามส่งซ้ำถ้ามีเลขออเดอร์" : "ไม่มี"}
        count={inFlight.length}
        tone={inFlight.length ? "warn" : "quiet"}
        icon={<AlertTriangle className="size-3.5" strokeWidth={1.8} />}
        onClick={() => onGoBatches({ batchStatus: "SENT" })}
      />
      <FocusRow
        title="ชุดต้องดู"
        sub={needsLookSub(needsLook)}
        count={needsLook.length}
        tone={needsLook.length ? "alert" : "quiet"}
        icon={<Clock className="size-3.5" strokeWidth={1.8} />}
        onClick={() => onGoBatches({ batchStuck: true })}
      />
    </div>
  );
}

function FollowUpHeroRight({
  pending,
  processing,
  review,
  held,
  open,
  inFlight,
  needsLook,
  onGoList,
  onGoBatches,
}: {
  pending: Payout[];
  processing: Payout[];
  review: Payout[];
  held: number;
  open: Batch[];
  inFlight: Batch[];
  needsLook: Batch[];
  onGoList: (statuses: string[]) => void;
  onGoBatches: (patch: { batchStatus?: string; batchStuck?: boolean }) => void;
}) {
  const [tab, setTab] = useState<QueueTab>("payouts");
  const stuckCount = needsLook.filter((b) => b.stuck).length;
  const followTone: DotTone = stuckCount ? "bad" : needsLook.length ? "warn" : "ok";

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2">
          <h2 className="type-section">ต้องติดตามตอนนี้</h2>
          <StatusDot tone={followTone} pulse={followTone === "ok"} />
        </div>
        <div className="inline-flex items-center gap-1 rounded-lg border border-foreground/10 bg-foreground/2 p-0.5">
          <QueueTabButton
            active={tab === "payouts"}
            onClick={() => setTab("payouts")}
            ariaLabel="รายการโอน"
            icon={<List className="size-3.5" strokeWidth={1.8} />}
            label="รายการโอน"
          />
          <QueueTabButton
            active={tab === "batches"}
            onClick={() => setTab("batches")}
            ariaLabel="ชุดโอน"
            icon={<Layers className="size-3.5" strokeWidth={1.8} />}
            label="ชุดโอน"
            trailing={stuckCount ? <StatusDot tone="bad" /> : null}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {tab === "payouts" ? (
          <>
            <div className="min-h-0 flex-1">
              <PayoutFocusList pending={pending} processing={processing} review={review} held={held} onGoList={onGoList} />
            </div>
            <StuckBatchHeading count={stuckCount} onClick={() => onGoBatches({ batchStuck: true })} />
          </>
        ) : (
          <BatchFocusList open={open} inFlight={inFlight} needsLook={needsLook} onGoBatches={onGoBatches} />
        )}
      </div>

      <p className="type-label shrink-0 pt-3">
        สแนปชอตคิว ณ ตอนนี้ · ไม่ตามวันที่เลือก · poll 15 วินาที
      </p>
    </div>
  );
}

export function OverviewZone1({
  source,
  pending,
  processing,
  review,
  held,
  open,
  inFlight,
  needsLook,
  onGoList,
  onGoBatches,
}: {
  source: SourceAccount | null;
  pending: Payout[];
  processing: Payout[];
  review: Payout[];
  held: number;
  open: Batch[];
  inFlight: Batch[];
  needsLook: Batch[];
  onGoList: (statuses: string[]) => void;
  onGoBatches: (patch: { batchStatus?: string; batchStuck?: boolean }) => void;
}) {
  const openCount = pending.length + processing.length + review.length;

  return (
    <div className="grid items-stretch gap-3 lg:grid-cols-[1.17fr_1fr]">
      <div className="flex h-full min-h-0 flex-col gap-3">
        <Card className="flex min-h-0 flex-1 overflow-hidden py-0">
          <SourceHeroLeft source={source} />
        </Card>
        <SourceStatRow source={source} held={held} openCount={openCount} />
      </div>
      <Card className="flex h-full min-h-0 overflow-hidden py-0">
        <FollowUpHeroRight
          pending={pending}
          processing={processing}
          review={review}
          held={held}
          open={open}
          inFlight={inFlight}
          needsLook={needsLook}
          onGoList={onGoList}
          onGoBatches={onGoBatches}
        />
      </Card>
    </div>
  );
}
