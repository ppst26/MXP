/** โลโก้จำลองตามรหัสธนาคาร — ไม่ใช่เครื่องหมายการค้าจริง */
const MARK: Record<string, { name: string; bg: string; dark?: boolean }> = {
  "006": { name: "KTB", bg: "#0ea5e9" },
  "004": { name: "KBANK", bg: "#16a34a" },
  "014": { name: "SCB", bg: "#7c3aed" },
  "002": { name: "BBL", bg: "#1d4ed8" },
  "025": { name: "BAY", bg: "#eab308", dark: true },
  "011": { name: "TMB", bg: "#e4e4e7", dark: true },
};

function Glyph({ code, dark }: { code: string; dark?: boolean }) {
  const fill = dark ? "#18181b" : "#fafafa";
  switch (code) {
    case "006":
      return (
        <g fill="none" stroke={fill} strokeWidth="1.6" strokeLinecap="round">
          <path d="M4 7.5h12M4 10h12M4 12.5h12" />
        </g>
      );
    case "004":
      return (
        <g fill={fill}>
          <circle cx="10" cy="7.2" r="2.1" />
          <circle cx="7.2" cy="12" r="2.1" />
          <circle cx="12.8" cy="12" r="2.1" />
        </g>
      );
    case "014":
      return (
        <path
          d="M5 14.5c2.2-5 4-8.5 10-9.2"
          fill="none"
          stroke={fill}
          strokeWidth="2"
          strokeLinecap="round"
        />
      );
    case "002":
      return <path d="M10 3.8 15.2 16H4.8Z" fill={fill} />;
    case "025":
      return <circle cx="10" cy="10" r="4.2" fill={fill} />;
    case "011":
      return <path d="M5 5h10v2.2H11.1V15H8.9V7.2H5Z" fill={fill} />;
    default:
      return null;
  }
}

export function BankMark({
  code,
  name,
}: {
  code: string;
  name?: string;
}) {
  const mark = MARK[code];
  const label = mark ? `${mark.name} ${code}` : `${name ?? "ธนาคาร"} ${code}`;
  const bg = mark?.bg ?? "#3f3f46";
  const dark = mark?.dark ?? false;

  return (
    <span
      title={label}
      aria-label={label}
      className="inline-flex size-5 shrink-0 overflow-hidden rounded-[5px]"
    >
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden>
        <rect width="20" height="20" rx="5" fill={bg} />
        {mark ? <Glyph code={code} dark={dark} /> : (
          <text x="10" y="13.5" textAnchor="middle" fill="#fafafa" fontSize="7" fontWeight="700">
            {code.slice(0, 3)}
          </text>
        )}
      </svg>
    </span>
  );
}
