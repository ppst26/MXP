import { Area, Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { Payout, PayoutStatus } from "../../mock/types";
import { money, pct } from "../../lib/money";
import { metrics, queueAge } from "../../mock/query";
import { routeLabel, statusLabel } from "../../lib/status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const tsConfig = {
  current: { label: "ช่วงนี้", color: "var(--primary)" },
  previous: { label: "ช่วงก่อน", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

type SeriesPoint = { label: string; current: number | null; previous: number | null };

const STATUS_ORDER: PayoutStatus[] = [
  "COMPLETED",
  "PROCESSING",
  "PENDING",
  "NEEDS_REVIEW",
  "FAILED",
  "REJECTED",
];

const STATUS_STACK_CLASS: Record<PayoutStatus, string> = {
  COMPLETED: "bg-success",
  PROCESSING: "bg-primary",
  PENDING: "bg-muted-foreground/45",
  NEEDS_REVIEW: "bg-warning",
  FAILED: "bg-destructive",
  REJECTED: "bg-orange-500",
};

function ChartLegendRow() {
  return (
    <div className="mt-2 flex gap-4 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <i className="inline-block h-0.5 w-3.5 rounded-full bg-primary" />
        ช่วงนี้
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i className="inline-block h-0.5 w-3.5 rounded-full border border-dashed border-muted-foreground bg-muted-foreground/40" />
        ช่วงก่อน
      </span>
    </div>
  );
}

function CompletedAmountChart({ ts }: { ts: SeriesPoint[] }) {
  const data = ts.map((d) => ({ ...d, current: d.current ?? 0, previous: d.previous ?? 0 }));
  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-[13px] font-semibold">ยอดโอนสำเร็จ</CardTitle>
          <CardDescription>ยอดเงินสำเร็จรายชั่วโมง</CardDescription>
        </div>
        <span className="text-[11px] text-muted-foreground">วันนี้</span>
      </CardHeader>
      <CardContent>
        <ChartContainer config={tsConfig} className="aspect-auto h-[182px] w-full">
          <LineChart data={data} accessibilityLayer margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
            <YAxis hide domain={[0, "auto"]} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => (
                    <span>
                      {name === "current" ? "ช่วงนี้" : "ช่วงก่อน"} · {money(Number(value))}
                    </span>
                  )}
                />
              }
            />
            <Area type="monotone" dataKey="current" fill="var(--color-current)" fillOpacity={0.12} stroke="none" />
            <Line type="monotone" dataKey="previous" stroke="var(--color-previous)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
            <Line type="monotone" dataKey="current" stroke="var(--color-current)" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartContainer>
        <ChartLegendRow />
      </CardContent>
    </Card>
  );
}

const SUCCESS_TARGET = 98;

function SuccessRateChart({ rateTs, m, pm }: { rateTs: SeriesPoint[]; m: ReturnType<typeof metrics>; pm: ReturnType<typeof metrics> }) {
  const data = rateTs.map((d) => ({
    ...d,
    current: d.current ?? undefined,
    previous: d.previous ?? undefined,
  }));
  const deltaPts = (m.successRate - pm.successRate) * 100;
  const deltaUp = deltaPts >= 0;

  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-[13px] font-semibold">อัตราสำเร็จ</CardTitle>
          <CardDescription>การเปลี่ยนแปลงรายชั่วโมง</CardDescription>
        </div>
        <span className={cn("text-[11px] font-medium", deltaUp ? "text-success" : "text-destructive")}>
          {deltaUp ? "↑" : "↓"} {Math.abs(deltaPts).toFixed(1)} จุด
        </span>
      </CardHeader>
      <CardContent>
        <div className="mb-3">
          <div className="text-[30px] font-semibold leading-none tracking-tight tabular-nums">
            {(m.successRate * 100).toFixed(1)}
            <span className="ml-1 text-xs font-medium text-muted-foreground">%</span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">เป้าหมายการดำเนินงาน {SUCCESS_TARGET.toFixed(1)}%</p>
        </div>
        <ChartContainer config={tsConfig} className="aspect-auto h-[74px] w-full">
          <LineChart data={data} accessibilityLayer margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} minTickGap={32} hide={data.length > 12} />
            <YAxis hide domain={[0, 100]} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => (
                    <span>
                      {name === "current" ? "ช่วงนี้" : "ช่วงก่อน"} · {Number(value).toFixed(1)}%
                    </span>
                  )}
                />
              }
            />
            <Line type="monotone" dataKey="previous" stroke="var(--color-previous)" strokeWidth={1.25} strokeDasharray="4 4" dot={false} connectNulls />
            <Line type="monotone" dataKey="current" stroke="var(--color-current)" strokeWidth={2} dot={false} connectNulls />
          </LineChart>
        </ChartContainer>
        <ChartLegendRow />
      </CardContent>
    </Card>
  );
}

function RoutePerformanceBars({
  rows,
  showHouse,
}: {
  rows: Payout[];
  showHouse: boolean;
}) {
  const routes = (["SAME_BANK", "INTERBANK"] as const).map((r) => ({
    route: r,
    m: metrics(rows.filter((p) => p.route === r)),
  }));
  const same = routes.find((x) => x.route === "SAME_BANK")!;
  const inter = routes.find((x) => x.route === "INTERBANK")!;
  const deltaPts = (inter.m.successRate - same.m.successRate) * 100;

  return (
    <div className="flex flex-col gap-4">
      {routes.map(({ route, m }) => (
        <div key={route} className="space-y-1.5">
          <div className="flex items-start justify-between gap-2 text-[11px]">
            <span className="font-medium text-foreground">{routeLabel(route)}</span>
            <span className="text-right tabular-nums text-muted-foreground">
              {m.count} ใบ · {money(m.amount)}
              {showHouse && route === "INTERBANK" ? ` · ค่าโอน ${money(m.incurred)}` : showHouse ? " · ค่าโอน 0.00" : null}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Progress value={m.successRate * 100} className="h-1.5 flex-1" />
            <span className="w-10 text-right text-[11px] font-medium tabular-nums text-foreground">{pct(m.successRate)}</span>
          </div>
        </div>
      ))}
      {same.m.count > 0 && inter.m.count > 0 ? (
        <p className={cn("text-[11px]", deltaPts < 0 ? "text-warning" : "text-muted-foreground")}>
          ข้ามธนาคาร {deltaPts >= 0 ? "สูงกว่า" : "ต่ำกว่า"} ในธนาคาร {Math.abs(deltaPts).toFixed(1)} จุด
        </p>
      ) : null}
    </div>
  );
}

function StatusStack({ rows }: { rows: Payout[] }) {
  const total = rows.length;
  const segments = STATUS_ORDER.map((status) => ({
    status,
    label: statusLabel(status),
    count: rows.filter((p) => p.status === status).length,
  })).filter((s) => s.count > 0);

  if (!total) {
    return <p className="text-xs text-muted-foreground">ไม่มีใบในช่วงที่เลือก</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {segments.map((s) => (
          <div
            key={s.status}
            className={cn("h-full min-w-0 transition-all", STATUS_STACK_CLASS[s.status])}
            style={{ width: `${(s.count / total) * 100}%` }}
            title={`${s.label} ${s.count} (${((s.count / total) * 100).toFixed(1)}%)`}
          />
        ))}
      </div>
      <div className="space-y-1">
        {segments.map((s) => (
          <div key={s.status} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <i className={cn("inline-block size-2 rounded-sm", STATUS_STACK_CLASS[s.status])} />
              {s.label}
            </span>
            <span className="tabular-nums text-foreground">
              {s.count} · {((s.count / total) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ComparePairs({
  rows,
  queue,
  ts,
  rateTs,
  m,
  pm,
  showHouse,
}: {
  rows: Payout[];
  queue: Payout[];
  ts: SeriesPoint[];
  rateTs: SeriesPoint[];
  m: ReturnType<typeof metrics>;
  pm: ReturnType<typeof metrics>;
  showHouse: boolean;
}) {
  const ages = queueAge(queue);
  const openCount = ages.reduce((s, a) => s + a.count, 0);
  const ageMax = Math.max(1, ...ages.map((a) => a.count));

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-[1.38fr_1fr]">
        <CompletedAmountChart ts={ts} />
        <SuccessRateChart rateTs={rateTs} m={m} pm={pm} />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardDescription>คู่ 2 — ประสิทธิภาพเส้นทาง</CardDescription>
            <CardTitle className="text-[13px] font-semibold">ในธนาคาร vs ข้ามธนาคาร</CardTitle>
          </CardHeader>
          <CardContent>
            <RoutePerformanceBars rows={rows} showHouse={showHouse} />
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>คู่ 3 — สัดส่วนสถานะช่วง</CardDescription>
            <CardTitle className="text-[13px] font-semibold">{rows.length} ใบในช่วงที่เลือก</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusStack rows={rows} />
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardDescription>อายุคิวที่ยังไม่จบ</CardDescription>
              <CardTitle className="text-[13px] font-semibold">รายการรอส่งและกำลังส่ง ณ ตอนนี้</CardTitle>
            </div>
            <span className="text-[11px] text-muted-foreground">{openCount} ใบ</span>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {ages.map((a) => {
              const pctW = (a.count / ageMax) * 100;
              const tone = a.label.startsWith(">") ? "bg-destructive" : a.label.includes("30") ? "bg-warning" : "bg-primary";
              return (
                <div key={a.label} className="grid grid-cols-[72px_1fr_28px] items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{a.label}</span>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full", tone)} style={{ width: `${pctW}%` }} />
                  </div>
                  <span className="text-right tabular-nums text-foreground">{a.count}</span>
                </div>
              );
            })}
            <p className="mt-auto text-xs text-muted-foreground">
              {ages.map((a) => `${a.label} ${a.count}`).join(" · ")}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
