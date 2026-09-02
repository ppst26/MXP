import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ReferenceLine, XAxis, YAxis } from "recharts";
import type { MerchantPeriodFee, Payout } from "../../mock/types";
import { money, pct } from "../../lib/money";
import { INTERBANK_FEE, merchantPeriodFees, metrics } from "../../mock/query";
import { routeLabel } from "../../lib/status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

const tsConfig = {
  current: { label: "ช่วงนี้", color: "var(--primary)" },
  previous: { label: "ช่วงก่อน", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

type SeriesPoint = { label: string; current: number | null; previous: number | null };
type VolumePoint = SeriesPoint & {
  countCurrent: number;
  countPrevious: number;
  batchCurrent: number;
  batchPrevious: number;
};
type CountMode = "count" | "batch";
type AxisKind = "money" | "count" | "pct";

const feeBarConfig = {
  fee: { label: "ค่าโอน", color: "var(--warning)" },
} satisfies ChartConfig;

const bankCountConfig = {
  count: { label: "ใบ", color: "var(--primary)" },
} satisfies ChartConfig;

const pieConfig = {
  fee: { label: "ค่าบริการร้าน" },
} satisfies ChartConfig;

const SLICE_COLORS = [
  "var(--chart-1)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-2)",
  "var(--chart-5)",
  "var(--warning)",
  "var(--muted-foreground)",
];

/** สีแท่งตามรหัสธนาคารผู้รับ */
const BANK_BAR_COLOR: Record<string, string> = {
  "006": "#38bdf8",
  "011": "#f4f4f5",
  "004": "#22c55e",
  "002": "#2563eb",
  "025": "#eab308",
  "014": "#8b5cf6",
};

const BANK_BAR_COLOR_BY_NAME: Record<string, string> = {
  KTB: "#38bdf8",
  TMB: "#f4f4f5",
  KBANK: "#22c55e",
  BBL: "#2563eb",
  BAY: "#eab308",
  SCB: "#8b5cf6",
};

function bankBarFill(code: string, name: string): string {
  return BANK_BAR_COLOR[code] ?? BANK_BAR_COLOR_BY_NAME[name] ?? "var(--muted-foreground)";
}

function formatAxisTick(value: number, kind: AxisKind): string {
  if (kind === "pct") return `${Math.round(value)}`;
  if (kind === "count") return Math.round(value).toLocaleString("th-TH");
  if (Math.abs(value) >= 1000) {
    const k = value / 1000;
    return `${k.toLocaleString("th-TH", { maximumFractionDigits: k >= 10 ? 0 : 1 })}k`;
  }
  return value.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

function MetricYAxis({ kind }: { kind: AxisKind }) {
  return (
    <YAxis
      tickLine={false}
      axisLine={false}
      width={kind === "money" ? 48 : 36}
      tickMargin={8}
      tickCount={5}
      domain={kind === "pct" ? [0, 100] : [0, "auto"]}
      tickFormatter={(v) => formatAxisTick(Number(v), kind)}
    />
  );
}

function ChartLegendRow() {
  return (
    <div className="type-label mt-2 flex gap-4">
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

function CompletedAmountChart({ ts, grain }: { ts: VolumePoint[]; grain: "hour" | "day" }) {
  const data = ts.map((d) => ({
    label: d.label,
    current: d.current ?? 0,
    previous: d.previous ?? 0,
  }));
  const grainLabel = grain === "hour" ? "รายชั่วโมง" : "รายวัน";

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>ยอดโอนสำเร็จ</CardTitle>
        <CardDescription>ยอดเงิน COMPLETED {grainLabel}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={tsConfig} className="aspect-auto h-[182px] w-full">
          <LineChart data={data} accessibilityLayer margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
            <MetricYAxis kind="money" />
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

function CompletedCountChart({
  ts,
  grain,
  showBatches,
}: {
  ts: VolumePoint[];
  grain: "hour" | "day";
  showBatches: boolean;
}) {
  const [mode, setMode] = useState<CountMode>("count");
  const view = mode === "batch" && !showBatches ? "count" : mode;
  const data = ts.map((d) => ({
    label: d.label,
    current: view === "batch" ? d.batchCurrent : d.countCurrent,
    previous: view === "batch" ? d.batchPrevious : d.countPrevious,
  }));
  const grainLabel = grain === "hour" ? "รายชั่วโมง" : "รายวัน";
  const unit = view === "batch" ? "ชุด" : "ใบ";

  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>{view === "batch" ? "จำนวนชุด" : "จำนวนใบสำเร็จ"}</CardTitle>
          <CardDescription>{view === "batch" ? `ชุดที่เปิด ${grainLabel}` : `ใบ COMPLETED ${grainLabel}`}</CardDescription>
        </div>
        {showBatches ? (
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={view}
            onValueChange={(v) => {
              if (v === "count" || v === "batch") setMode(v);
            }}
          >
            <ToggleGroupItem value="count">ใบ</ToggleGroupItem>
            <ToggleGroupItem value="batch">ชุด</ToggleGroupItem>
          </ToggleGroup>
        ) : null}
      </CardHeader>
      <CardContent>
        <ChartContainer config={tsConfig} className="aspect-auto h-[182px] w-full">
          <BarChart data={data} accessibilityLayer margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
            <MetricYAxis kind="count" />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => (
                    <span>
                      {name === "current" ? "ช่วงนี้" : "ช่วงก่อน"} · {Number(value).toLocaleString("th-TH")} {unit}
                    </span>
                  )}
                />
              }
            />
            <Bar dataKey="previous" fill="var(--color-previous)" radius={2} maxBarSize={12} />
            <Bar dataKey="current" fill="var(--color-current)" radius={2} maxBarSize={12} />
          </BarChart>
        </ChartContainer>
        <ChartLegendRow />
      </CardContent>
    </Card>
  );
}

const SUCCESS_TARGET = 98;

function SuccessRateChart({
  rateTs,
  m,
  pm,
  grain,
}: {
  rateTs: SeriesPoint[];
  m: ReturnType<typeof metrics>;
  pm: ReturnType<typeof metrics>;
  grain: "hour" | "day";
}) {
  const data = rateTs.map((d) => ({
    ...d,
    current: d.current ?? undefined,
    previous: d.previous ?? undefined,
  }));
  const deltaPts = (m.successRate - pm.successRate) * 100;
  const deltaUp = deltaPts >= 0;
  const grainLabel = grain === "hour" ? "รายชั่วโมง" : "รายวัน";

  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>อัตราสำเร็จ</CardTitle>
          <CardDescription>
            {grainLabel} · เป้า {SUCCESS_TARGET.toFixed(1)}%
          </CardDescription>
        </div>
        <div className="text-right">
          <div className="type-kpi tabular-nums">
            {(m.successRate * 100).toFixed(1)}
            <span className="ml-1 text-xs font-medium text-muted-foreground">%</span>
          </div>
          <span className={cn("type-label font-medium", deltaUp ? "text-success" : "text-destructive")}>
            {deltaUp ? "↑" : "↓"} {Math.abs(deltaPts).toFixed(1)} จุด
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <ChartContainer config={tsConfig} className="aspect-auto h-[182px] w-full">
          <AreaChart data={data} accessibilityLayer margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
            <MetricYAxis kind="pct" />
            <ReferenceLine y={SUCCESS_TARGET} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
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
            <Area type="monotone" dataKey="previous" stroke="var(--color-previous)" fill="var(--color-previous)" fillOpacity={0.08} strokeDasharray="4 4" connectNulls />
            <Area type="monotone" dataKey="current" stroke="var(--color-current)" fill="var(--color-current)" fillOpacity={0.2} connectNulls />
          </AreaChart>
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
    <div className="grid grid-cols-2 gap-3">
      {routes.map(({ route, m }) => (
        <div key={route} className="surface-nested rounded-sm border border-foreground/10 p-3">
          <p className="type-label text-muted-foreground">{routeLabel(route)}</p>
          <p className="type-kpi mt-1 tabular-nums">{pct(m.successRate)}</p>
          <p className="type-label mt-1 tabular-nums">
            {m.count} ใบ · {money(m.amount)}
            {showHouse && route === "INTERBANK" ? ` · ค่าโอน ${money(m.incurred)}` : showHouse ? " · ค่าโอน 0.00" : null}
          </p>
        </div>
      ))}
      {same.m.count > 0 && inter.m.count > 0 ? (
        <p className={cn("type-label col-span-2", deltaPts < 0 ? "text-warning" : "text-muted-foreground")}>
          ข้ามธนาคาร {deltaPts >= 0 ? "สูงกว่า" : "ต่ำกว่า"} ในธนาคาร {Math.abs(deltaPts).toFixed(1)} จุด
        </p>
      ) : null}
    </div>
  );
}

function DestinationBanks({
  rows,
  onPick,
}: {
  rows: Payout[];
  onPick?: (bankCode: string) => void;
}) {
  const total = rows.length;
  const map = new Map<string, { code: string; name: string; count: number; amount: number }>();
  for (const p of rows) {
    const cur = map.get(p.recipientBankCode) ?? {
      code: p.recipientBankCode,
      name: p.recipientBankName,
      count: 0,
      amount: 0,
    };
    cur.count += 1;
    cur.amount += p.amount;
    map.set(p.recipientBankCode, cur);
  }
  const grouped = [...map.values()].sort((a, b) => b.count - a.count);

  if (!total) {
    return <p className="text-xs text-muted-foreground">ไม่มีใบในช่วงที่เลือก</p>;
  }

  const data = grouped.map((b) => ({ ...b, short: b.name }));

  return (
    <ChartContainer config={bankCountConfig} className="aspect-auto h-[200px] w-full">
      <BarChart data={data} layout="vertical" accessibilityLayer margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="short" tickLine={false} axisLine={false} width={44} tickMargin={4} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, _name, item) => {
                const row = item?.payload as { count: number; amount: number };
                return (
                  <span>
                    {Number(value).toLocaleString("th-TH")} ใบ · {money(row.amount)}
                  </span>
                );
              }}
            />
          }
        />
        <Bar
          dataKey="count"
          radius={[0, 4, 4, 0]}
          maxBarSize={18}
          cursor={onPick ? "pointer" : undefined}
          onClick={(d) => {
            const code = (d as { code?: string }).code;
            if (code) onPick?.(code);
          }}
        >
          {data.map((b) => (
            <Cell
              key={b.code}
              fill={bankBarFill(b.code, b.name)}
              stroke={b.name === "TMB" || b.code === "011" ? "var(--border)" : "transparent"}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

const FEE_TOP = 6;

function topMerchants(
  shops: MerchantPeriodFee[],
  valueOf: (r: MerchantPeriodFee) => number,
): { id: string; name: string; code: string; row: MerchantPeriodFee }[] {
  const sorted = [...shops].filter((s) => valueOf(s) > 0).sort((a, b) => valueOf(b) - valueOf(a));
  if (sorted.length <= FEE_TOP) {
    return sorted.map((row) => ({ id: row.id, name: row.name, code: row.code, row }));
  }
  const head = sorted.slice(0, FEE_TOP);
  const rest = sorted.slice(FEE_TOP);
  const other: MerchantPeriodFee = {
    id: "other",
    name: "อื่นๆ",
    code: "",
    amount: rest.reduce((s, r) => s + r.amount, 0),
    reservedFee: rest.reduce((s, r) => s + r.reservedFee, 0),
    incurred: rest.reduce((s, r) => s + r.incurred, 0),
    incurredCount: rest.reduce((s, r) => s + r.incurredCount, 0),
    interbankCount: rest.reduce((s, r) => s + r.interbankCount, 0),
  };
  return [...head, other].map((row) => ({ id: row.id, name: row.name, code: row.code, row }));
}

function MerchantMdrCard({
  rows,
  onPick,
}: {
  rows: Payout[];
  onPick?: (merchantId: string) => void;
}) {
  const shops = merchantPeriodFees(rows);
  const totalFee = shops.reduce((s, r) => s + r.reservedFee, 0);
  const totalAmt = shops.reduce((s, r) => s + r.amount, 0);
  const items = topMerchants(shops, (r) => r.reservedFee);
  const data = items.map((i, idx) => ({
    id: i.id,
    name: i.name,
    fee: i.row.reservedFee,
    fill: SLICE_COLORS[idx % SLICE_COLORS.length],
  }));

  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>ค่าบริการร้าน · MDR</CardTitle>
          <CardDescription>สัดส่วนค่าธรรมเนียมร้าน</CardDescription>
        </div>
        <div className="text-right">
          <div className="type-kpi tabular-nums">{money(totalFee, 4)}</div>
          <p className="type-label">{totalAmt ? pct(totalFee / totalAmt) : "0.0%"} ของยอดโอน</p>
        </div>
      </CardHeader>
      <CardContent>
        {data.length ? (
          <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <ChartContainer config={pieConfig} className="aspect-auto mx-auto h-[180px] w-full max-w-[220px]">
              <PieChart>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_label, payload) => {
                        const row = payload?.[0]?.payload as { name?: string } | undefined;
                        return row?.name ?? "";
                      }}
                      formatter={(value) => (
                        <span className="font-mono font-medium tabular-nums">{money(Number(value), 4)}</span>
                      )}
                    />
                  }
                />
                <Pie
                  data={data}
                  dataKey="fee"
                  nameKey="name"
                  innerRadius={48}
                  outerRadius={72}
                  strokeWidth={2}
                  onClick={(d) => {
                    const id = (d as { id?: string }).id;
                    if (id && id !== "other") onPick?.(id);
                  }}
                >
                  {data.map((d) => (
                    <Cell key={d.id} fill={d.fill} className="cursor-pointer stroke-card" />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <ul className="space-y-1.5">
              {data.map((d) => (
                <li key={d.id} className="type-label flex items-center justify-between gap-2">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <i className="size-2 shrink-0 rounded-sm" style={{ background: d.fill }} />
                    <span className="truncate">{d.name}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{money(d.fee, 4)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">ไม่มีข้อมูลในช่วงที่เลือก</p>
        )}
        <p className="type-label mt-3">SUM(reserved_fee) ต่อร้านในช่วง · ห้ามบวกกับค่าโอนธนาคาร</p>
      </CardContent>
    </Card>
  );
}

function MerchantBankFeeCard({
  rows,
  onPick,
}: {
  rows: Payout[];
  onPick?: (merchantId: string) => void;
}) {
  const shops = merchantPeriodFees(rows);
  const items = topMerchants(shops, (r) => r.interbankCount * INTERBANK_FEE);
  const data = items.map((i, idx) => ({
    id: i.id,
    name: i.name,
    fee: i.row.interbankCount * INTERBANK_FEE,
    slips: i.row.interbankCount,
    fill: SLICE_COLORS[idx % SLICE_COLORS.length],
  }));
  const totalQuoted = data.reduce((s, d) => s + d.fee, 0);
  const totalSlips = data.reduce((s, d) => s + d.slips, 0);

  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>ค่าโอนธนาคาร · บ้านจ่าย</CardTitle>
          <CardDescription>สะสมต่อร้านในช่วง</CardDescription>
        </div>
        <div className="text-right">
          <div className="type-kpi tabular-nums">{money(totalQuoted)}</div>
          <p className="type-label">
            {INTERBANK_FEE.toFixed(2)} × {totalSlips} ใบข้ามธนาคาร
          </p>
        </div>
      </CardHeader>
      <CardContent>
        {data.length ? (
          <ChartContainer config={feeBarConfig} className="aspect-auto h-[200px] w-full">
            <BarChart data={data} accessibilityLayer margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} interval={0} />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(v) => formatAxisTick(Number(v), "money")}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => (
                      <span className="font-mono font-medium tabular-nums">{money(Number(value))}</span>
                    )}
                  />
                }
              />
              <Bar
                dataKey="fee"
                radius={[4, 4, 0, 0]}
                maxBarSize={36}
                cursor={onPick ? "pointer" : undefined}
                onClick={(d) => {
                  const id = (d as { id?: string }).id;
                  if (id && id !== "other") onPick?.(id);
                }}
              >
                {data.map((d) => (
                  <Cell key={d.id} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        ) : (
          <p className="text-xs text-muted-foreground">ไม่มีใบข้ามธนาคารในช่วงที่เลือก</p>
        )}
        <p className="type-label mt-3">
          ผู้รับไม่ใช่ KTB = ข้ามธนาคาร · {INTERBANK_FEE.toFixed(2)} บาท × จำนวนใบถอนต่อร้าน · ไม่บวกกับ MDR
        </p>
      </CardContent>
    </Card>
  );
}

export type PeriodPayoutPatch = {
  recipientBankCode?: string;
};

export function ComparePairs({
  rows,
  ts,
  rateTs,
  m,
  pm,
  showHouse,
  grain,
  onGoPayouts,
  onPickMerchant,
}: {
  rows: Payout[];
  ts: VolumePoint[];
  rateTs: SeriesPoint[];
  m: ReturnType<typeof metrics>;
  pm: ReturnType<typeof metrics>;
  showHouse: boolean;
  grain: "hour" | "day";
  onGoPayouts: (patch: PeriodPayoutPatch) => void;
  onPickMerchant?: (merchantId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-[7fr_3fr]">
        <CompletedAmountChart ts={ts} grain={grain} />
        <CompletedCountChart ts={ts} grain={grain} showBatches={showHouse} />
      </div>
      {showHouse ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <MerchantMdrCard rows={rows} onPick={onPickMerchant} />
          <MerchantBankFeeCard rows={rows} onPick={onPickMerchant} />
        </div>
      ) : null}
      <div className={showHouse ? "grid gap-3 lg:grid-cols-3" : "grid gap-3 lg:grid-cols-2"}>
        {showHouse ? (
          <Card size="sm">
            <CardHeader>
              <CardTitle>ในธนาคาร vs ข้ามธนาคาร</CardTitle>
              <CardDescription>คู่ 2 — ประสิทธิภาพเส้นทาง</CardDescription>
            </CardHeader>
            <CardContent>
              <RoutePerformanceBars rows={rows} showHouse={showHouse} />
            </CardContent>
          </Card>
        ) : null}
        <Card size="sm">
          <CardHeader>
            <CardTitle>ธนาคารที่โอนไป</CardTitle>
            <CardDescription>{rows.length} ใบในช่วงที่เลือก</CardDescription>
          </CardHeader>
          <CardContent>
            <DestinationBanks
              rows={rows}
              onPick={(code) => onGoPayouts({ recipientBankCode: code })}
            />
          </CardContent>
        </Card>
        <SuccessRateChart rateTs={rateTs} m={m} pm={pm} grain={grain} />
      </div>
    </div>
  );
}
