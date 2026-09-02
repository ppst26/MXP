import type { MerchantBooks, Payout, PayoutStatus } from "../../mock/types";
import { Card } from "@/components/ui/card";
import { MerchantZone2Cards } from "./MerchantZone2Cards";
import { MerchantFollowUp } from "./MerchantFollowUp";

export function MerchantRealtimeZone({
  books,
  pending,
  processing,
  review,
  held,
  onHeld,
  onGoList,
}: {
  books: MerchantBooks | null;
  pending: Payout[];
  processing: Payout[];
  review: Payout[];
  held: number;
  onHeld: () => void;
  onGoList: (statuses: PayoutStatus[]) => void;
}) {
  return (
    <Card className="overflow-hidden py-0">
      <div className="grid items-stretch lg:grid-cols-[1.17fr_1fr]">
        <div className="flex min-h-[22rem] flex-col p-6">
          <MerchantZone2Cards books={books} onHeld={onHeld} />
        </div>
        <div className="flex min-h-[22rem] flex-col border-t border-border lg:border-t-0 lg:border-l">
          <MerchantFollowUp
            pending={pending}
            processing={processing}
            review={review}
            held={held}
            showHeld={!books}
            onGoList={onGoList}
          />
        </div>
      </div>
    </Card>
  );
}
