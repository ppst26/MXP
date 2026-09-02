import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { addCalendarMonths, fmtD, MAX_RANGE_MONTHS, rangeFromDays, startOfDay } from "../lib/bangkok";
import { useFilters } from "../state/FilterProvider";

export function DateRangePicker() {
  const { filters, setFilters } = useFilters();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();
  const selected: DateRange = draft ?? { from: filters.from, to: filters.to };
  const anchor = draft?.from && !draft.to ? startOfDay(draft.from) : null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setDraft(undefined);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarIcon data-icon="inline-start" />
          {fmtD(filters.from)} – {fmtD(filters.to)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="range"
          numberOfMonths={2}
          selected={selected}
          disabled={
            anchor
              ? [
                  { before: addCalendarMonths(anchor, -MAX_RANGE_MONTHS) },
                  { after: addCalendarMonths(anchor, MAX_RANGE_MONTHS) },
                ]
              : undefined
          }
          onSelect={(range) => {
            setDraft(range);
            if (range?.from && range.to) {
              setFilters(rangeFromDays(range.from, range.to));
              setDraft(undefined);
              setOpen(false);
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
