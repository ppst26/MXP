import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  listBoUsers,
  listShopMembers,
  listShopUserSummaries,
  merchById,
  MOCK_DIRECT_USER,
} from "../../mock/query";
import { db } from "../../mock/seed";
import { useAccessMock } from "../../state/use-access-mock";
import { useFilters } from "../../state/FilterProvider";
import { useViewer } from "../../state/use-viewer";
import type { BoUser } from "../../mock/types";
import { useSortedPagination } from "../../hooks/use-sorted-pagination";
import { MerchantPicker } from "../../layout/MerchantPicker";
import { PageBackLink } from "@/components/page-back-link";
import { Zone } from "@/components/metric-card";
import { TablePagination } from "@/components/table-pagination";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserTable } from "./UserTable";
import { ShopTable } from "./ShopTable";
import { UserCreateDialog } from "./UserCreateDialog";

const shopAccessors = {
  name: (r: ReturnType<typeof listShopUserSummaries>[number]) => r.name,
  operate: (r: ReturnType<typeof listShopUserSummaries>[number]) => r.operate,
  pendingAmount: (r: ReturnType<typeof listShopUserSummaries>[number]) => r.pendingAmount,
  accountCount: (r: ReturnType<typeof listShopUserSummaries>[number]) => r.accountCount,
  lastLoginAt: (r: ReturnType<typeof listShopUserSummaries>[number]) => r.lastLoginAt?.getTime() ?? 0,
};

const personAccessors = {
  shop: (u: BoUser) => u.merchantId ?? "",
  username: (u: BoUser) => u.username,
  role: (u: BoUser) => u.role,
  status: (u: BoUser) => u.status,
  twoFactor: (u: BoUser) => (u.twoFactor ? 1 : 0),
  lastLoginAt: (u: BoUser) => u.lastLoginAt?.getTime() ?? 0,
};

type Props = {
  surface: "shops" | "platform" | "merchant";
};

export function UsersPageContent({ surface }: Props) {
  const isAdmin = surface !== "merchant";
  const nav = useNavigate();
  const { merchantId: shopParam } = useParams();
  const { scopedMerchantId } = useViewer();
  const { setFilters, setPreset } = useFilters();
  const { users, flash, clearFlash, createUser, setStatus, resetPassword, merchantName, renameShop, renameDisplayName } =
    useAccessMock();
  const [filterMerchantId, setFilterMerchantId] = useState("");
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [pending, setPending] = useState<
    | { type: "status"; user: BoUser }
    | { type: "reset"; user: BoUser; temp?: string }
    | { type: "rename-shop"; merchantId: string }
    | { type: "rename-display"; user: BoUser }
    | null
  >(null);
  const [draftName, setDraftName] = useState("");
  const [renameError, setRenameError] = useState("");

  const shop = shopParam ? merchById(shopParam) : undefined;
  const shopMissing = Boolean(surface === "shops" && shopParam && (!shop || shop.role !== "DIRECT"));
  const drillDown = Boolean(surface === "shops" && shop && shop.role === "DIRECT");
  const shopList = surface === "shops" && !shopParam;
  const platform = surface === "platform";

  const personRows = useMemo(() => {
    if (shopList) return [];
    if (drillDown && shopParam) return listShopMembers(users, shopParam, q);
    if (surface === "merchant") return listShopMembers(users, scopedMerchantId || MOCK_DIRECT_USER, q);
    return listBoUsers(users, {
      tab: "admin",
      merchantId: "",
      q,
      isAdmin: true,
    });
  }, [users, q, drillDown, shopParam, surface, scopedMerchantId, shopList]);

  const shopRows = useMemo(
    () =>
      shopList
        ? listShopUserSummaries(users, {
            merchantId: filterMerchantId,
            q,
            nameOf: merchantName,
            db,
          })
        : [],
    [shopList, users, filterMerchantId, q, merchantName],
  );

  const shopResetKey = `${filterMerchantId}|${q}|${shopRows.length}`;
  const personResetKey = `${surface}|${filterMerchantId}|${q}|${shopParam ?? ""}|${personRows.length}`;
  const shopPaging = useSortedPagination(shopRows, shopAccessors, shopResetKey);
  const personPaging = useSortedPagination(personRows, personAccessors, personResetKey);
  const paging = shopList ? shopPaging : personPaging;

  if (shopMissing) {
    return (
      <div className="flex flex-col gap-4">
        <PageBackLink to="/shops" className="-ml-2 self-start">
          กลับรายชื่อร้าน
        </PageBackLink>
        <header>
          <h1 className="page-title">404</h1>
          <p className="text-sm text-muted-foreground">ไม่พบร้านนี้</p>
        </header>
      </div>
    );
  }

  if (surface === "merchant" && shopParam) {
    return <Navigate to="/users" replace />;
  }

  const shopLabel = shopParam ? merchantName(shopParam) : undefined;
  const title = drillDown
    ? `บัญชีร้าน · ${shopLabel ?? shopParam}`
    : shopList
      ? "จัดการร้านค้า"
      : platform
        ? "แอดมิน"
        : "ผู้ใช้";

  const zoneTitle = drillDown
    ? `ผู้ใช้ร้านและแอดมินร้านของ ${shopLabel ?? "ร้าน"}`
    : shopList
      ? "รายชื่อร้านค้า"
      : platform
        ? "รายชื่อแอดมินแพลตฟอร์ม"
        : "รายชื่อผู้ใช้";

  return (
    <div className="flex flex-col gap-6">
      {drillDown ? (
        <PageBackLink to="/shops" className="-ml-2 self-start">
          กลับรายชื่อร้าน
        </PageBackLink>
      ) : null}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="page-header">
          <h1 className="page-title">{title}</h1>
          <p className="page-description">
            {drillDown
              ? `บัญชีภายใต้ ${shopLabel ?? "ร้านนี้"} รวมแอดมินร้านและผู้ใช้ร้าน · ข้อมูลจำลอง`
              : shopList
                ? "ยอดถอนได้และรายการที่รออยู่ต่อร้าน กดแถวเพื่อดูผู้ใช้ร้านกับแอดมินร้าน · ข้อมูลจำลอง"
                : platform
                  ? "แพลตฟอร์มแอดมินทั้งระบบ ไม่รวมแอดมินร้าน · ข้อมูลจำลอง"
                  : `${merchantName(MOCK_DIRECT_USER)} เห็นเฉพาะบัญชีของร้านนี้ รวมแอดมินร้าน · ข้อมูลจำลอง`}
          </p>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          สร้างผู้ใช้
        </Button>
      </header>

      {flash ? (
        <Alert>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{flash}</span>
            <Button type="button" variant="ghost" size="sm" onClick={clearFlash}>
              ปิด
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-wrap items-end gap-3" aria-label="ตัวกรอง">
        {shopList ? <MerchantPicker merchantId={filterMerchantId} onChange={setFilterMerchantId} /> : null}
        <div className="flex min-w-[200px] flex-1 flex-col gap-1 sm:max-w-xs">
          <Label className="type-label">ค้นหา</Label>
          <Input
            value={q}
            placeholder={shopList ? "ชื่อร้านหรือรหัส" : isAdmin ? "ชื่อผู้ใช้" : "ชื่อผู้ใช้"}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </section>

      <Zone title={zoneTitle}>
        <div className="overflow-auto rounded-sm surface-nested ring-1 ring-foreground/5">
          {shopList ? (
            <ShopTable
              rows={shopPaging.slice}
              sort={{ sortKey: shopPaging.sortKey, sortDir: shopPaging.sortDir, onSort: shopPaging.requestSort }}
              onOpen={(id) => nav(`/shops/${id}`)}
              onPending={(id) => {
                setPreset("d30");
                setFilters({
                  merchantId: id,
                  statuses: ["PENDING", "PROCESSING", "NEEDS_REVIEW"],
                  listPage: 1,
                });
                nav("/payouts");
              }}
              onRename={(id) => {
                setRenameError("");
                setDraftName(merchantName(id));
                setPending({ type: "rename-shop", merchantId: id });
              }}
            />
          ) : (
            <UserTable
              rows={personPaging.slice}
              showShop={false}
              shopName={merchantName}
              sort={{ sortKey: personPaging.sortKey, sortDir: personPaging.sortDir, onSort: personPaging.requestSort }}
              onOpenHistory={(userId) => nav(`/login-history?userId=${encodeURIComponent(userId)}`)}
              onToggleStatus={(user) => setPending({ type: "status", user })}
              onResetPassword={(user) => setPending({ type: "reset", user })}
              onRenameDisplay={(user) => {
                setRenameError("");
                setDraftName(user.displayName);
                setPending({ type: "rename-display", user });
              }}
            />
          )}
        </div>
        <TablePagination
          page={paging.page}
          pages={paging.pages}
          pageSize={paging.pageSize}
          total={paging.total}
          onPageChange={paging.setPage}
          onPageSizeChange={paging.setPageSize}
        />
      </Zone>

      <UserCreateDialog
        open={createOpen}
        isAdmin={isAdmin}
        scopedMerchantId={drillDown && shopParam ? shopParam : scopedMerchantId || MOCK_DIRECT_USER}
        lockShop={Boolean(drillDown) || surface === "merchant"}
        lockPlatform={platform}
        onOpenChange={setCreateOpen}
        onCreate={(input) => {
          const result = createUser(input);
          if (result.ok && result.user.kind === "merchant" && result.user.merchantId && isAdmin) {
            nav(`/shops/${result.user.merchantId}`);
          }
          return result;
        }}
      />

      <Dialog
        open={pending != null}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
            setRenameError("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          {pending?.type === "status" ? (
            <>
              <DialogHeader>
                <DialogTitle>{pending.user.status === "active" ? "ปิดใช้ผู้ใช้" : "เปิดใช้ผู้ใช้"}</DialogTitle>
                <DialogDescription>
                  {pending.user.status === "active"
                    ? `${pending.user.username} จะเข้าสู่ระบบไม่ได้จนกว่าจะเปิดใช้อีกครั้ง`
                    : `เปิดใช้ ${pending.user.username} ให้เข้าสู่ระบบได้อีก`}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPending(null)}>
                  ยกเลิก
                </Button>
                <Button
                  type="button"
                  variant={pending.user.status === "active" ? "destructive" : "default"}
                  onClick={() => {
                    setStatus(pending.user.id, pending.user.status === "active" ? "disabled" : "active");
                    setPending(null);
                  }}
                >
                  ยืนยัน
                </Button>
              </DialogFooter>
            </>
          ) : pending?.type === "reset" ? (
            <>
              <DialogHeader>
                <DialogTitle>รีเซ็ตรหัสผ่าน</DialogTitle>
                <DialogDescription>
                  {pending.temp
                    ? `รหัสชั่วคราวของ ${pending.user.username}: ${pending.temp}`
                    : `จะออกรหัสชั่วคราวให้ ${pending.user.username} และบังคับเปลี่ยนตอนเข้าครั้งถัดไป`}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                {pending.temp ? (
                  <Button type="button" onClick={() => setPending(null)}>
                    ปิด
                  </Button>
                ) : (
                  <>
                    <Button type="button" variant="outline" onClick={() => setPending(null)}>
                      ยกเลิก
                    </Button>
                    <Button
                      type="button"
                      onClick={() => {
                        const temp = resetPassword(pending.user.id);
                        if (temp) setPending({ type: "reset", user: pending.user, temp });
                      }}
                    >
                      รีเซ็ต
                    </Button>
                  </>
                )}
              </DialogFooter>
            </>
          ) : pending?.type === "rename-shop" ? (
            <>
              <DialogHeader>
                <DialogTitle>เปลี่ยนชื่อร้าน</DialogTitle>
                <DialogDescription>
                  รหัสร้าน {merchById(pending.merchantId)?.code ?? pending.merchantId} ไม่เปลี่ยน · ชื่อนี้โชว์ในหลังบ้าน
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1">
                <Label className="type-label">ชื่อร้าน</Label>
                <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
                {renameError ? <p className="text-sm text-destructive">{renameError}</p> : null}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPending(null)}>
                  ยกเลิก
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    const result = renameShop(pending.merchantId, draftName);
                    if (!result.ok) {
                      setRenameError(result.error);
                      return;
                    }
                    setPending(null);
                  }}
                >
                  บันทึก
                </Button>
              </DialogFooter>
            </>
          ) : pending?.type === "rename-display" ? (
            <>
              <DialogHeader>
                <DialogTitle>เปลี่ยนชื่อที่แสดง</DialogTitle>
                <DialogDescription>
                  username {pending.user.username} ไม่เปลี่ยน · ใช้เข้าระบบและประวัติเหมือนเดิม
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1">
                <Label className="type-label">ชื่อที่แสดง</Label>
                <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
                {renameError ? <p className="text-sm text-destructive">{renameError}</p> : null}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPending(null)}>
                  ยกเลิก
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    const result = renameDisplayName(pending.user.id, draftName);
                    if (!result.ok) {
                      setRenameError(result.error);
                      return;
                    }
                    setPending(null);
                  }}
                >
                  บันทึก
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
