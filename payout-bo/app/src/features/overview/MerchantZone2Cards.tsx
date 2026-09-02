import type { MerchantBooks } from "../../mock/types";
import { money } from "../../lib/money";
import { MerchantWithdrawHero } from "./MerchantWithdrawHero";
import { cn } from "@/lib/utils";

export function MerchantZone2Cards({
  books,
  onHeld,
}: {
  books: MerchantBooks | null;
  onHeld: () => void;
}) {
  if (!books) {
    return (
      <p className="type-label leading-relaxed">
        ไม่มีข้อมูลสมุดร้านในขอบเขตนี้
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <MerchantWithdrawHero books={books} />

      <div className="mt-auto flex flex-col gap-3 pt-6">
        <HeldLine
          label="กันไว้รอจบรอบถอน"
          value={books.pendingPayout}
          detail="รวมใบที่ยังไม่จบและรอตรวจ"
          onClick={books.pendingPayout ? onHeld : undefined}
        />
        {books.parking > 0 ? (
          <HeldLine label="เงินที่แอดมินพักไว้" value={books.parking} muted />
        ) : null}
        {books.freeze > 0 ? (
          <HeldLine label="เงินที่ถูกอายัด" value={books.freeze} warn />
        ) : null}
        <p className="text-sm leading-relaxed text-muted-foreground">
          ยอดร้านรวม ฿ {money(books.balance)} · ตัวเลขจากสมุด ไม่ตามวันที่ที่เลือก
        </p>
      </div>
    </div>
  );
}

function HeldLine({
  label,
  value,
  detail,
  muted,
  warn,
  onClick,
}: {
  label: string;
  value: number;
  detail?: string;
  muted?: boolean;
  warn?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="min-w-0">
        <p className="text-base font-medium text-foreground/90">{label}</p>
        {detail ? <p className="mt-1 text-sm text-muted-foreground">{detail}</p> : null}
      </div>
      <p
        className={cn(
          "type-stat-value shrink-0",
          muted && "text-muted-foreground",
          warn && "text-warning",
        )}
      >
        ฿ {money(value)}
      </p>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-between gap-4 text-left"
      >
        {body}
      </button>
    );
  }

  return <div className="flex items-center justify-between gap-4">{body}</div>;
}
