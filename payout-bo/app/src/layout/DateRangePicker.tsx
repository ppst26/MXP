import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtD, rangeFromDays } from "../lib/bangkok";
import { useFilters } from "../state/FilterProvider";

export function DateRangePicker() {
  const { filters, setFilters } = useFilters();
  const [open, setOpen] = useState(false);
  const selected: DateRange = { from: filters.from, to: filters.to };

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
          onSelect={(range) => {
            if (range?.from && range.to) {
              setFilters(rangeFromDays(range.from, range.to));
              setOpen(false);
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
