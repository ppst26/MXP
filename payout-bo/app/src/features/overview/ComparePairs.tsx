import { Area, Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type { PeriodMetrics, Payout } from "../../mock/types";
import { money, pct } from "../../lib/money";
import { metrics, queueAge } from "../../mock/query";
import { statusLabel } from "../../lib/status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

const tsConfig = {
  current: { label: "ช่วงนี้", color: "var(--primary)" },
  previous: { label: "ช่วงก่อน", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

const funnelConfig = {
  count: { label: "ใบ", color: "var(--chart-2)" },
} satisfies ChartConfig;

type SeriesPoint = { label: string; current: number | null; previous: number | null };

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

function SuccessRateChart({ rateTs, m, pm }: { rateTs: SeriesPoint[]; m: PeriodMetrics; pm: PeriodMetrics }) {
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
  m: PeriodMetrics;
  pm: PeriodMetrics;
  showHouse: boolean;
}) {
  const routes = (["SAME_BANK", "INTERBANK"] as const).map((r) => ({ route: r, m: metrics(rows.filter((p) => p.route === r)) }));
  const fn = (["PENDING", "PROCESSING", "COMPLETED", "FAILED", "REJECTED", "NEEDS_REVIEW"] as const).map((s) => ({
    name: statusLabel(s),
    count: rows.filter((p) => p.status === s).length,
  }));
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
            <CardDescription>คู่ 2 — ในธนาคาร vs ข้ามธนาคาร</CardDescription>
          </CardHeader>
          <CardContent>
            <table className="data-table">
              <thead>
                <tr>
                  <th>เส้นทาง</th>
                  <th className="num">ใบ</th>
                  <th className="num">ยอด</th>
                  <th className="num">สำเร็จ</th>
                  {showHouse ? <th className="num">ค่าโอน</th> : null}
                </tr>
              </thead>
              <tbody>
                {routes.map((x) => (
                  <tr key={x.route}>
                    <td>{x.route === "INTERBANK" ? "ข้ามธนาคาร" : "ในธนาคาร"}</td>
                    <td className="num">{x.m.count}</td>
                    <td className="num">{money(x.m.amount)}</td>
                    <td className="num">{pct(x.m.successRate)}</td>
                    {showHouse ? <td className="num">{money(x.m.incurred)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>คู่ 3 — กรวยสถานะ + อายุคิวตอนนี้</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={funnelConfig} className="aspect-auto h-48">
              <BarChart data={fn} layout="vertical" accessibilityLayer>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={72} tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={2} />
              </BarChart>
            </ChartContainer>
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
