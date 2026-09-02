import { useEffect, useState } from "react";
import { fmtDT } from "../lib/bangkok";

export function HeaderClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <span className="hidden tabular-nums text-xs text-muted-foreground lg:inline">
      {fmtDT(now)} น.
    </span>
  );
}
