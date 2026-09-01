export function money(n: number, dp = 2): string {
  return Number(n).toLocaleString("th-TH", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

export function money4(n: number): string {
  return Number(n).toFixed(4);
}

export function money2(n: number): string {
  return Number(n).toFixed(2);
}

export function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

export function deltaLabel(cur: number, prev: number): { text: string; dir: "up" | "down" } {
  const d = (cur - prev) / (prev || 1);
  const sign = d >= 0 ? "+" : "";
  return { text: `${sign}${(d * 100).toFixed(1)}% vs ช่วงก่อน`, dir: d >= 0 ? "up" : "down" };
}
