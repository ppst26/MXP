import type { BoUser } from "../../mock/types";
import type { SortDir } from "../../lib/sort";
import { merchById } from "../../mock/query";
import { fmtDTThai } from "../../lib/bangkok";
import { boUserRoleLabel, boUserStatusLabel } from "../../lib/access";
import { SortableTh } from "@/components/sortable-table-head";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type SortProps = {
  sortKey: string | null;
  sortDir: SortDir;
  onSort: (key: string) => void;
};

type Props = {
  rows: BoUser[];
  showShop?: boolean;
  shopName?: (merchantId: string) => string;
  sort: SortProps;
  onOpenHistory: (userId: string) => void;
  onToggleStatus: (user: BoUser) => void;
  onResetPassword: (user: BoUser) => void;
  onRenameDisplay: (user: BoUser) => void;
};

export function UserTable({
  rows,
  showShop = false,
  shopName,
  sort,
  onOpenHistory,
  onToggleStatus,
  onResetPassword,
  onRenameDisplay,
}: Props) {
  if (!rows.length) {
    return <p className="py-12 text-center text-sm text-muted-foreground">ไม่พบผู้ใช้ตามตัวกรอง</p>;
  }

  const canAct = (u: BoUser) => u.kind !== "platform" && u.role !== "platform_admin";
  const showActions = rows.some(canAct);
  const { sortKey, sortDir, onSort } = sort;

  return (
    <table className="data-table relaxed">
      <thead>
        <tr>
          {showShop ? (
            <SortableTh label="ร้านค้า" sortKey="shop" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          ) : null}
          <SortableTh label="ชื่อผู้ใช้" sortKey="username" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <SortableTh label="บทบาท" sortKey="role" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <SortableTh label="สถานะ" sortKey="status" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <SortableTh label="2FA" sortKey="twoFactor" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          <SortableTh label="เข้าสู่ล่าสุด" sortKey="lastLoginAt" activeKey={sortKey} direction={sortDir} onSort={onSort} />
          {showActions ? <th>การทำงาน</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((u) => {
          const shop = u.merchantId ? merchById(u.merchantId) : undefined;
          return (
            <tr key={u.id} className="clickable" onClick={() => onOpenHistory(u.id)}>
              {showShop ? (
                <td>
                      {shop ? (
                    <>
                      {shopName?.(shop.id) ?? shop.name}
                      <div className="text-xs text-muted-foreground">{shop.code}</div>
                    </>
                  ) : (
                    "แพลตฟอร์ม"
                  )}
                </td>
              ) : null}
              <td>
                <span className="font-medium">{u.username}</span>
                <div className="text-xs text-muted-foreground">{u.displayName}</div>
                {u.mustChangePassword ? (
                  <div className="text-xs text-warning">ต้องเปลี่ยนรหัสตอนเข้าครั้งถัดไป</div>
                ) : null}
              </td>
              <td>{boUserRoleLabel(u.role)}</td>
              <td>
                <Badge variant={u.status === "active" ? "default" : "secondary"}>
                  {boUserStatusLabel(u.status)}
                </Badge>
              </td>
              <td>
                <Badge variant={u.twoFactor ? "secondary" : "outline"}>{u.twoFactor ? "เปิด" : "ยังไม่เปิด"}</Badge>
              </td>
              <td>{u.lastLoginAt ? fmtDTThai(u.lastLoginAt) : "—"}</td>
              {showActions ? (
                <td>
                  {canAct(u) ? (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRenameDisplay(u);
                        }}
                      >
                        เปลี่ยนชื่อที่แสดง
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleStatus(u);
                        }}
                      >
                        {u.status === "active" ? "ปิดใช้" : "เปิดใช้"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onResetPassword(u);
                        }}
                      >
                        รีเซ็ตรหัส
                      </Button>
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
