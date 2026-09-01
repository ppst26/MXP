import type { MerchantBooks } from "../../mock/types";
import { money } from "../../lib/money";
import { MetricCard } from "@/components/metric-card";

export function MerchantBooksCards({
  books,
  onHeld,
}: {
  books: MerchantBooks;
  onHeld: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="ใช้ได้"
          value={money(books.operate)}
          hint="MERCHANT_OPERATE · สั่งถอนได้จากยอดนี้"
          tone={books.operate <= 0 ? "warn" : undefined}
        />
        <MetricCard
          label="กันไว้รอถอน"
          value={money(books.pendingPayout)}
          hint="MERCHANT_PENDING_PAYOUT · ใบที่ยังไม่จบรวมรอคนดู"
          tone={books.pendingPayout ? undefined : "quiet"}
          onClick={onHeld}
        />
        {books.parking > 0 ? (
          <MetricCard label="พักไว้" value={money(books.parking)} hint="MERCHANT_PARKING · แอดมินย้ายมา ไม่ใช่คิวถอน" tone="quiet" />
        ) : null}
        {books.freeze > 0 ? (
          <MetricCard label="อายัด" value={money(books.freeze)} hint="MERCHANT_FREEZE · ข้อพิพาท ไม่รวมกันถอน" tone="warn" />
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        ยอดร้าน {money(books.balance)} = ใช้ได้ + พัก + อายัด + กันถอน · ตัวเลขสมุด ไม่ใช่ผลรวมใบในช่วงวันที่เลือก
      </p>
    </div>
  );
}
