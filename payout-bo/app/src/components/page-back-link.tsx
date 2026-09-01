import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PageBackLinkProps = {
  to: string;
  children: ReactNode;
  className?: string;
};

export function PageBackLink({ to, children, className }: PageBackLinkProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground", className)}
      asChild
    >
      <Link to={to}>
        <ChevronLeft className="size-3.5 shrink-0" />
        {children}
      </Link>
    </Button>
  );
}

type DetailPageShellProps = {
  backTo?: string;
  backLabel?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** กรอบหน้ารายละเอียด — ปุ่มกลับแถวบนสุด ชิดซ้าย แยกจาก heading */
export function DetailPageShell({ backTo, backLabel, children, className }: DetailPageShellProps) {
  return (
    <div className={cn("mx-auto flex w-full max-w-[1420px] flex-col gap-5", className)}>
      {backTo && backLabel ? (
        <PageBackLink to={backTo} className="-ml-2 self-start">
          {backLabel}
        </PageBackLink>
      ) : null}
      {children}
    </div>
  );
}

type DetailPageHeaderProps = {
  children: ReactNode;
  trailing?: ReactNode;
};

/** หัวหน้ารายละเอียด (ไม่รวมปุ่มกลับ) */
export function DetailPageHeader({ children, trailing }: DetailPageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">{children}</div>
      {trailing}
    </div>
  );
}
