import type { BoUser, LoginEvent } from "../../mock/types";
import type { SortDir } from "../../lib/sort";
import { merchById } from "../../mock/query";
import { fmtDTThai } from "../../lib/bangkok";
import { loginResultLabel, loginStageLabel } from "../../lib/access";
import { SortableTh } from "@/components/sortable-table-head";
import { Badge } from "@/components/ui/badge";

type SortProps = {
  sortKey: string | null;
  sortDir: SortDir;
  onSort: (key: string) => void;
};

type Props = {
  rows: LoginEvent[];
  users: BoUser[];
  isAdmin: boolean;
  shopName: (merchantId: string) => string;
  sort: SortProps;
};

export function LoginHistoryTable({ rows, users, isAdmin, shopName, sort }: Props) {
  if (!rows.length) {
    return <p className="py-12 text-center text-sm text-muted-foreground">ไม่พบรายการตามตัวกรอง</p>;
  }
  const byId = new Map(users.map((u) => [u.id, u]));
  const { sortKey, sortDir, onSort } = sort;

  return (
    <table className="data-table relaxed">
      <thead>
        <tr>
          <SortableTh label="เวลา" sortKey="at" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <SortableTh label={isAdmin ? "ร้านค้า" : "ชื่อผู้ใช้"} sortKey="user" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <SortableTh label="ด่าน" sortKey="stage" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <SortableTh label="ผล" sortKey="result" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <SortableTh label="สาเหตุ" sortKey="reason" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <SortableTh label="IP" sortKey="ip" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <SortableTh label="อุปกรณ์" sortKey="device" activeKey={sortKey} direction={sortDir} onSort={onSort} />
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => {
          const u = byId.get(e.userId);
          const shop = e.merchantId ? merchById(e.merchantId) : undefined;
          return (
            <tr key={e.id}>
              <td>{fmtDTThai(e.at)}</td>
              <td>
                {isAdmin ? (
                  <>
                    {shop ? shopName(shop.id) : "แพลตฟอร์ม"}
                    <div className="text-xs text-muted-foreground">{u?.username ?? e.userId}</div>
                  </>
                ) : (
                  <>
                    {u?.username ?? e.userId}
                    <div className="text-xs text-muted-foreground">{u?.displayName ?? ""}</div>
                  </>
                )}
              </td>
              <td>
                <Badge variant="secondary">{loginStageLabel(e.stage)}</Badge>
              </td>
              <td>
                <Badge variant={e.result === "success" ? "default" : "destructive"}>
                  {loginResultLabel(e.result)}
                </Badge>
              </td>
              <td>{e.reason ?? "—"}</td>
              <td className="font-mono text-xs">{e.ip}</td>
              <td className="text-muted-foreground">{e.device}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
