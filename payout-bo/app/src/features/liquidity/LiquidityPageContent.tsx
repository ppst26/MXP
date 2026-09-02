import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Landmark, Shield, Wallet } from "lucide-react";
import { db } from "../../mock/seed";
import { listMerchantBookRows, queueHeldOf, queuePayouts } from "../../mock/query";
import { money } from "../../lib/money";
import { fmtDT } from "../../lib/bangkok";
import { useOverviewData } from "../overview/use-overview-data";
import { useFilters } from "../../state/FilterProvider";
import { MetricCard, Zone } from "@/components/metric-card";
import { Badge } from "@/components/ui/badge";
import { SortableTh } from "@/components/sortable-table-head";
import { TablePagination } from "@/components/table-pagination";
import { useSortedPagination } from "@/hooks/use-sorted-pagination";
import { cn } from "@/lib/utils";

const iconProps = { strokeWidth: 1.8 } as const;

const shopAccessors = {
  name: (r: ReturnType<typeof listMerchantBookRows>[number]) => r.name,
  operate: (r: ReturnType<typeof listMerchantBookRows>[number]) => r.operate,
  pendingPayout: (r: ReturnType<typeof listMerchantBookRows>[number]) => r.pendingPayout,
};

export function LiquidityPageContent() {
  const nav = useNavigate();
  const { source } = useOverviewData();
  const { setFilters, setPreset } = useFilters();
  const held = queueHeldOf(queuePayouts(db, ""));
  const shops = useMemo(
    () => listMerchantBookRows(db).filter((r) => r.role === "DIRECT"),
    [],
  );
  const {
    slice: shopSlice,
    page: shopPage,
    pages: shopPages,
    total: shopTotal,
    pageSize: shopPageSize,
    setPage: setShopPage,
    setPageSize: setShopPageSize,
    sortKey,
    sortDir,
    requestSort,
  } = useSortedPagination(shops, shopAccessors, "liquidity-shops");

  if (!source) {
    return (
      <div className="flex flex-col gap-6">
        <header className="page-header">
          <h1 className="page-title">บัญชีจ่ายและสำรอง</h1>
          <p className="page-description">ยังไม่ตั้งบัญชีต้นทาง — ห้ามเดายอดจากร้าน</p>
        </header>
      </div>
    );
  }

  const bufferLeft = source.bankBalance - source.minBalance;
  const coverQueue = source.bankBalance - held - source.minBalance;
  const low = source.bankBalance < source.minBalance;

  return (
    <div className="flex flex-col gap-6">
      <header className="page-header">
        <h1 className="page-title">บัญชีจ่ายและสำรอง</h1>
        <p className="page-description">
          ยอดธนาคารจริงของบัญชีจ่าย คู่กับสำรองขั้นต่ำและคิวที่กันไว้ · คนละชั้นกับสมุดร้าน · กวาดเงินอัตโนมัติยังไม่อยู่ในเฟสนี้
        </p>
      </header>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<Landmark {...iconProps} />}
          label="ยอดบัญชีจ่าย"
          value={`฿ ${money(source.bankBalance)}`}
          hint={`${source.bankName} ${source.accountNo} · ${fmtDT(source.bankBalanceAt)}`}
          tone={low ? "alert" : undefined}
        />
        <MetricCard
          icon={<Shield {...iconProps} />}
          label="สำรองขั้นต่ำ"
          value={`฿ ${money(source.minBalance)}`}
          hint={`เหลือเหนือสำรอง ฿ ${money(bufferLeft)}`}
          tone={low ? "alert" : undefined}
        />
        <MetricCard
          icon={<Wallet {...iconProps} />}
          label="คิวที่กันไว้"
          value={`฿ ${money(held)}`}
          hint="PENDING + PROCESSING ทั้งระบบ"
        />
        <MetricCard
          icon={<Wallet {...iconProps} />}
          label="พอจ่ายคิว+สำรอง"
          value={coverQueue >= 0 ? `฿ ${money(coverQueue)}` : `ขาด ฿ ${money(-coverQueue)}`}
          hint={`เพดานวัน ฿ ${money(source.dailyAmountCap)} · ใช้แล้ว ฿ ${money(source.dailyAmountUsed)}`}
          tone={coverQueue < 0 ? "alert" : undefined}
        />
      </div>

      <Zone title="บัญชีจ่าย">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="type-label">ชื่อบัญชี</dt>
            <dd>{source.accountName}</dd>
          </div>
          <div>
            <dt className="type-label">ชั้น</dt>
            <dd>
              <Badge variant="outline">{source.tier}</Badge>
              <span className="ml-2 text-muted-foreground">{source.status}</span>
            </dd>
          </div>
          <div>
            <dt className="type-label">ยอดหนังสือ</dt>
            <dd className="tabular-nums">฿ {money(source.bookBalance)}</dd>
          </div>
          <div>
            <dt className="type-label">ส่วนต่างธนาคาร − หนังสือ</dt>
            <dd className="tabular-nums">฿ {money(source.bankBalance - source.bookBalance)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          ถ้ายอดธนาคารกับยอดหนังสือไม่ตรง แปลว่ามีเงินที่ระบบยังไม่ลงสมุด — ไล่ต่อที่กระทบยอดขาออก
        </p>
      </Zone>

      <Zone title="สภาพคล่องร้าน">
        <div className="overflow-auto rounded-sm surface-nested ring-1 ring-foreground/5">
          <table className="data-table relaxed">
            <thead>
              <tr>
                <SortableTh label="ร้าน" sortKey="name" activeKey={sortKey} direction={sortDir} onSort={requestSort} />
                <SortableTh label="ใช้ได้" sortKey="operate" activeKey={sortKey} direction={sortDir} onSort={requestSort} className="num" />
                <SortableTh label="กันถอน" sortKey="pendingPayout" activeKey={sortKey} direction={sortDir} onSort={requestSort} className="num" />
              </tr>
            </thead>
            <tbody>
              {shopSlice.map((r) => (
                <tr
                  key={r.merchantId}
                  className="clickable"
                  onClick={() => {
                    setPreset("d30");
                    setFilters({ merchantId: r.merchantId, listPage: 1 });
                    nav("/payouts/overview");
                  }}
                >
                  <td>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">{r.code}</div>
                  </td>
                  <td className={cn("num text-base font-semibold tabular-nums", r.operate <= 0 && "text-warning")}>
                    ฿ {money(r.operate)}
                  </td>
                  <td className="num text-base font-semibold tabular-nums">฿ {money(r.pendingPayout)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination
          page={shopPage}
          pages={shopPages}
          pageSize={shopPageSize}
          total={shopTotal}
          onPageChange={setShopPage}
          onPageSizeChange={setShopPageSize}
        />
        <p className="text-xs text-muted-foreground">ใช้ได้คือ MERCHANT_OPERATE หลังกันถอนแล้ว — ไม่ใช่ยอดในบัญชี บจก.</p>
      </Zone>
    </div>
  );
}
