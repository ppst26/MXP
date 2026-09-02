import type { MerchantBooks } from "../../mock/types";
import { money } from "../../lib/money";
import { cn } from "@/lib/utils";

export function MerchantWithdrawHero({ books }: { books: MerchantBooks }) {
  return (
    <div className="border-b border-border pb-5">
      <p className="text-sm font-semibold text-muted-foreground">ถอนได้ตอนนี้</p>
      <p
        className={cn(
          "type-hero-withdraw mt-2",
          books.operate <= 0 && "text-warning",
        )}
      >
        ฿ {money(books.operate)}
      </p>
      <p className="mt-3 text-base leading-snug text-foreground/85">
        ยอดในสมุดที่สั่งถอนได้ทันที · ไม่รวมเงินที่กันไว้รอจบรอบ
      </p>
    </div>
  );
}
