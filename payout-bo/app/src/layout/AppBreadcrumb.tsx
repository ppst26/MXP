import { Link, useLocation, useParams } from "react-router-dom";
import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { merchById } from "../mock/query";
import { useAccessMock } from "../state/use-access-mock";

type Crumb = {
  label: string;
  href?: string;
};

function buildCrumbs(
  pathname: string,
  referenceId?: string,
  batchId?: string,
  merchantId?: string,
  nameOf?: (merchantId: string) => string,
): Crumb[] {
  const root: Crumb = { label: "โอนออก", href: "/payouts/overview" };

  if (pathname.startsWith("/shops")) {
    const list: Crumb[] = [{ label: "จัดการร้านค้า", href: merchantId ? "/shops" : undefined }];
    if (merchantId && pathname !== "/shops") {
      list.push({ label: nameOf?.(merchantId) ?? merchById(merchantId)?.name ?? merchantId });
    }
    return list;
  }

  if (pathname.startsWith("/admins")) {
    return [{ label: "แอดมิน" }];
  }

  if (pathname.startsWith("/users")) {
    return [{ label: "ผู้ใช้" }];
  }

  if (pathname.startsWith("/login-history")) {
    return [{ label: "ประวัติเข้าระบบ" }];
  }

  if (pathname.startsWith("/payouts/batches")) {
    const list: Crumb[] = [root, { label: "ชุดโอน", href: "/payouts/batches" }];
    if (batchId && pathname !== "/payouts/batches") {
      list.push({ label: batchId });
    }
    return list;
  }

  if (pathname.startsWith("/payouts/rates")) {
    return [{ label: "เรตถอน" }, { label: "อัตราและส่วนต่าง" }];
  }
  if (pathname.startsWith("/payouts/books")) {
    return [{ label: "การเงินถอน" }, { label: "สมุดร้าน" }];
  }
  if (pathname.startsWith("/payouts/recon")) {
    return [{ label: "การเงินถอน" }, { label: "กระทบยอดขาออก" }];
  }
  if (pathname.startsWith("/payouts/liquidity")) {
    return [{ label: "สภาพคล่อง" }, { label: "บัญชีจ่ายและสำรอง" }];
  }

  if (pathname.startsWith("/payouts/overview") || pathname === "/") {
    return [root, { label: "ภาพรวม" }];
  }

  if (pathname === "/payouts") {
    return [root, { label: "รายการใบถอน" }];
  }

  if (referenceId && pathname === `/payouts/${referenceId}`) {
    return [root, { label: "รายการใบถอน", href: "/payouts" }, { label: referenceId }];
  }

  return [root];
}

export function AppBreadcrumb() {
  const { pathname } = useLocation();
  const { referenceId, batchId, merchantId } = useParams();
  const { merchantName } = useAccessMock();
  const crumbs = buildCrumbs(pathname, referenceId, batchId, merchantId, merchantName);

  return (
    <nav aria-label="breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-2 text-[13px]">
        {crumbs.map((crumb, i) => (
          <Fragment key={`${crumb.label}-${i}`}>
            {i > 0 ? (
              <li aria-hidden className="shrink-0 select-none text-foreground/35">
                /
              </li>
            ) : null}
            <li className="truncate">
              {crumb.href ? (
                <Link to={crumb.href} className="text-foreground/65 transition-colors hover:text-foreground">
                  {crumb.label}
                </Link>
              ) : (
                <span className={cn("truncate text-foreground", i === crumbs.length - 1 && "font-medium")}>
                  {crumb.label}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
