import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { db, TOPUP_SEED } from "../../mock/seed";
import { listInbox } from "../../mock/query";
import type { InboxItem } from "../../mock/types";
import { useFilters } from "../../state/FilterProvider";
import { useViewer } from "../../state/use-viewer";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function InboxRow({ item, onPick }: { item: InboxItem; onPick: (item: InboxItem) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(item)}
      className={cn(
        "flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-muted",
        item.tone === "alert" && "text-destructive",
        item.tone === "warn" && "text-warning",
      )}
    >
      <span className="text-sm font-medium">{item.title}</span>
      {item.detail ? <span className="text-xs text-muted-foreground">{item.detail}</span> : null}
    </button>
  );
}

export function NotificationBell() {
  const nav = useNavigate();
  const { isAdmin, demo, scopedMerchantId } = useViewer();
  const { setFilters, setPreset } = useFilters();
  const [open, setOpen] = useState(false);

  const inbox = useMemo(
    () =>
      listInbox(
        db,
        { isAdmin, merchantId: isAdmin ? "" : scopedMerchantId, demo },
        TOPUP_SEED,
      ),
    [isAdmin, scopedMerchantId, demo],
  );

  const onPick = (item: InboxItem) => {
    if (item.to.list) {
      setPreset("d30");
      setFilters({
        listPage: 1,
        batchListPage: 1,
        statuses: item.to.list.statuses ?? [],
        batchStatus: item.to.list.batchStatus ?? "",
        batchStuck: item.to.list.batchStuck ?? false,
      });
    }
    setOpen(false);
    nav(item.to.path);
  };

  const empty = inbox.live.length === 0 && inbox.recent.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label="แจ้งเตือน">
          <Bell />
          {inbox.badgeCount > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none text-white">
              {inbox.badgeCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <PopoverHeader className="px-2 py-1">
          <PopoverTitle>แจ้งเตือน</PopoverTitle>
        </PopoverHeader>
        {empty ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">ไม่มีเรื่องที่ต้องลงมือตอนนี้</p>
        ) : (
          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
            {inbox.live.length ? (
              <div>
                <p className="px-2 pb-1 text-xs text-muted-foreground">ต้องลงมือ</p>
                {inbox.live.map((item) => (
                  <InboxRow key={item.id} item={item} onPick={onPick} />
                ))}
              </div>
            ) : null}
            {inbox.recent.length ? (
              <div>
                <p className="px-2 pb-1 text-xs text-muted-foreground">ล่าสุด</p>
                {inbox.recent.map((item) => (
                  <InboxRow key={item.id} item={item} onPick={onPick} />
                ))}
              </div>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
