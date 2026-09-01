import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { Payout, SourceAccount } from "../../mock/types";
import { money, pct } from "../../lib/money";
import { metrics, queueAge, sumAmt } from "../../mock/query";
import { statusLabel } from "../../lib/status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";

const tsConfig = {
  current: { label: "ช่วงนี้", color: "var(--primary)" },
  previous: { label: "ช่วงก่อน", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

const funnelConfig = {
  count: { label: "ใบ", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function ComparePairs({
  rows,
  queue,
  ts,
  source,
  showHouse,
}: {
  rows: Payout[];
  queue: Payout[];
  ts: { label: string; current: number; previous: number }[];
  source: SourceAccount | null;
  showHouse: boolean;
}) {
  const routes = (["SAME_BANK", "INTERBANK"] as const).map((r) => ({ route: r, m: metrics(rows.filter((p) => p.route === r)) }));
  const fn = (["PENDING", "PROCESSING", "COMPLETED", "FAILED", "REJECTED", "NEEDS_REVIEW"] as const).map((s) => ({
    name: statusLabel(s),
    count: rows.filter((p) => p.status === s).length,
  }));
  const ages = queueAge(queue);
  const pendingProc = queue.filter((p) => p.status === "PENDING" || p.status === "PROCESSING");
  const qAmt = sumAmt(pendingProc);
  const capPct = source ? Math.min(100, (source.dailyAmountUsed / source.dailyAmountCap) * 100) : 0;
  const queuePct = source && source.bankBalance ? Math.min(100, (qAmt / source.bankBalance) * 100) : 0;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card size="sm">
        <CardHeader>
          <CardDescription>คู่ 1 — ยอดสำเร็จช่วงนี้ vs ช่วงก่อน</CardDescription>
          <CardTitle>แท่งเทียบช่วง</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={tsConfig} className="aspect-auto h-44">
            <BarChart data={ts} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="previous" fill="var(--color-previous)" radius={2} />
              <Bar dataKey="current" fill="var(--color-current)" radius={2} />
            </BarChart>
          </ChartContainer>
          <p className="mt-2 text-xs text-muted-foreground">ทึบ = ช่วงนี้ · จาง = ช่วงก่อน</p>
        </CardContent>
      </Card>
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
          <p className="mt-2 text-xs text-muted-foreground">
            อายุคิวที่ยังไม่จบ: {ages.map((a) => `${a.label} ${a.count}`).join(" · ")}
          </p>
        </CardContent>
      </Card>
      {showHouse && source ? (
        <Card size="sm">
          <CardHeader>
            <CardDescription>คู่ 4 — ยอดบัญชี vs คิว vs เพดานวัน</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div>
              <p className="text-xs text-muted-foreground">ยอดธนาคาร {money(source.bankBalance)}</p>
              <Progress value={37} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">คิวรอจ่าย {money(qAmt)}</p>
              <Progress value={queuePct} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                เพดานวัน ใช้ {money(source.dailyAmountUsed)} / {money(source.dailyAmountCap)}
              </p>
              <Progress value={capPct} />
            </div>
            {source.bankBalance < qAmt + source.minBalance ? (
              <Alert variant="destructive">
                <AlertDescription>บัญชีต้นทางไม่พอจ่ายทั้งคิว + เงินสำรอง</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
