import type { MerchantWatchRow } from "../../mock/types";
import { money } from "../../lib/money";

export function MerchantWatch({
  rows,
  onPick,
}: {
  rows: MerchantWatchRow[] | null;
  onPick: (merchantId: string) => void;
}) {
  if (rows === null) {
    return <p className="text-xs text-muted-foreground">ซ่อนตารางร้านที่ต้องดู เพราะกรองเหลือร้านเดียว — ดูการ์ดด้านบน</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">ร้านที่ต้องดู · เจ้าของระบบเท่านั้น · เรียงเตือนก่อนยอด</p>
      <div className="overflow-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>ร้าน</th>
              <th className="num">สำเร็จช่วงนี้</th>
              <th className="num">ล้ม</th>
              <th className="num">รอคนดู</th>
              <th className="num">รอส่ง</th>
              <th className="num">กันไว้</th>
              <th>เก่าสุด</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => {
              const heat = x.review || x.failed || (x.oldestMin != null && x.oldestMin >= 30);
              return (
                <tr key={x.id} className={`clickable${heat ? " font-medium" : ""}`} onClick={() => onPick(x.id)}>
                  <td>
                    {x.name} · {x.code}
                  </td>
                  <td className="num">
                    {x.completedCount} · {money(x.completedAmount)}
                  </td>
                  <td className="num">{x.failed}</td>
                  <td className="num">{x.review}</td>
                  <td className="num">{x.pending}</td>
                  <td className="num">{money(x.held)}</td>
                  <td>{x.oldestMin != null ? `${x.oldestMin} น.` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">คลิกแถวกรองร้านนี้บนภาพรวม · ไม่ใช่จอร้าน · สูงสุด 8 แถว</p>
    </div>
  );
}
