import { useState, type ReactNode } from "react";
import { AlertTriangle, Clock, Layers, Plus, Wallet } from "lucide-react";
import type { Batch, Payout, SourceAccount } from "../../mock/types";
import { money } from "../../lib/money";
import { BALANCE_MAX_AGE_MS, sumAmt } from "../../mock/query";
import { NOW } from "../../lib/bangkok";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
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

function FocusRow({
  title,
  sub,
  count,
  tone = "default",
  icon,
  onClick,
}: {
  title: string;
  sub: string;
  count: ReactNode;
  tone?: "default" | "warn" | "alert" | "quiet";
  icon: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "grid w-full grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-lg border border-border/80 bg-white/[0.018] p-2.5 text-left transition-colors hover:bg-white/[0.03]",
        onClick && "cursor-pointer",
      )}
    >
      <span
        className={cn(
          "flex size-7 items-center justify-center rounded-md bg-muted text-foreground/90",
          tone === "warn" && "bg-warning/10 text-warning",
          tone === "alert" && "bg-destructive/10 text-destructive",
          tone === "quiet" && "text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className={cn("block text-xs text-foreground/90", tone === "quiet" && "text-muted-foreground")}>{title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>
      </span>
      <span className={cn("text-sm font-semibold tabular-nums tracking-tight", tone === "quiet" && "text-muted-foreground")}>{count}</span>
    </button>
  );
}

function SourceHeroLeft({
  source,
  held,
  openCount,
}: {
  source: SourceAccount | null;
  held: number;
  openCount: number;
}) {
  if (!source) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <div className="inline-flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
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
  const bookMismatch = source.bookBalance !== source.bankBalance;
  const lowBalance = source.bankBalance < source.minBalance;

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="inline-flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
          <StatusDot tone={eyebrowTone(source)} pulse={eyebrowTone(source) === "ok"} />
          บัญชีต้นทางพร้อมโอน
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusItem label="รับคำสั่ง" tone={source.payoutEnabled ? "ok" : "bad"} />
          <StatusItem label="ส่งเงิน" tone={source.sendEnabled ? "ok" : "bad"} />
          <StatusItem label="บัญชี" tone={accountTone(source)} />
        </div>
      </div>

      <div className={cn("mt-3 text-[37px] font-semibold leading-none tracking-[-0.055em] tabular-nums", lowBalance && "text-destructive")}>
        ฿ {money(source.bankBalance)}
        <span className="ml-1 text-sm font-medium tracking-normal text-muted-foreground">THB</span>
      </div>

      <div className="mt-1.5 text-xs text-muted-foreground">
        {source.bankName} · {source.accountNo} · {source.accountName}
      </div>

      <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
        <div>
          {stale ? (
            <span className="text-warning">เก่า {ageMin} น. ห้ามอ่านว่าพอจ่าย</span>
          ) : (
            <span>รีเฟรช {ageMin} นาทีที่แล้ว</span>
          )}
          {" · "}
          สมุด {money(source.bookBalance)}
          {bookMismatch ? <span className="text-warning"> · ยอดสมุดไม่ตรงธนาคาร</span> : null}
        </div>
        {source.tier !== "OUTBOUND" ? (
          <div className="text-warning">
            tier {source.tier} · เตือน: ไม่ใช่ OUTBOUND
          </div>
        ) : null}
        {source.status !== "ACTIVE" ? <div className="text-destructive">สถานะบัญชี {source.status}</div> : null}
      </div>

      <div className="mt-6 grid grid-cols-2 border-t border-border pt-4">
        <div>
          <div className="text-[11px] text-muted-foreground/80">คิวที่กันไว้</div>
          <div className="mt-1 text-base font-semibold tabular-nums">฿ {money(held)}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {openCount} รายการที่ยังไม่จบ · PENDING + PROCESSING
          </div>
        </div>
        <div className="border-l border-border pl-5">
          <div className="text-[11px] text-muted-foreground/80">เพดานโอนวันนี้</div>
          <div className="mt-1 text-base font-semibold tabular-nums">
            ฿ {money(source.dailyAmountUsed)}
            <span className="text-xs font-medium text-muted-foreground"> / ฿ {money(source.dailyAmountCap)}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {source.dailyTxnUsed} จาก {source.dailyTxnCap} รายการ · สำรอง {money(source.minBalance)}
          </div>
        </div>
      </div>
    </div>
  );
}

type QueueTab = "payouts" | "batches";

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
    <div className="grid gap-2">
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
    <div className="grid gap-2">
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
        sub="รอคนดูหรือค้างเกินเกณฑ์"
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

  return (
    <div className="flex h-full flex-col bg-gradient-to-br from-[#151518] to-[#101011] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2">
          <h2 className="text-[13px] font-semibold">ต้องติดตามตอนนี้</h2>
          <StatusDot tone="ok" pulse />
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={tab}
          onValueChange={(v) => {
            if (v) setTab(v as QueueTab);
          }}
        >
          <ToggleGroupItem value="payouts" aria-label="รายการโอน">
            รายการโอน
          </ToggleGroupItem>
          <ToggleGroupItem value="batches" aria-label="ชุดโอน">
            ชุดโอน
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {tab === "payouts" ? (
        <PayoutFocusList pending={pending} processing={processing} review={review} held={held} onGoList={onGoList} />
      ) : (
        <BatchFocusList open={open} inFlight={inFlight} needsLook={needsLook} onGoBatches={onGoBatches} />
      )}

      <p className="mt-auto pt-3 text-[11px] text-muted-foreground">
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
    <Card className="overflow-hidden py-0">
      <div className="grid lg:grid-cols-[1.17fr_1fr]">
        <SourceHeroLeft source={source} held={held} openCount={openCount} />
        <div className="border-t border-border lg:border-t-0 lg:border-l">
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
        </div>
      </div>
    </Card>
  );
}
