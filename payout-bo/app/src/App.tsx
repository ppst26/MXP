import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { FilterProvider } from "./state/FilterProvider";
import { ViewerProvider } from "./state/ViewerProvider";
import { AdminOnly } from "./layout/AdminOnly";
import { RolePage } from "./routes/RolePage";
import { AccessMockProvider } from "./state/AccessMockProvider";
import { AdminOverviewPage } from "./pages/admin/OverviewPage";
import { MerchantOverviewPage } from "./pages/merchant/OverviewPage";
import { AdminPayoutsPage } from "./pages/admin/PayoutsPage";
import { MerchantPayoutsPage } from "./pages/merchant/PayoutsPage";
import { AdminBatchesPage } from "./pages/admin/BatchesPage";
import { AdminBatchDetailPage } from "./pages/admin/BatchDetailPage";
import { PayoutDetailPage } from "./pages/shared/PayoutDetailPage";
import { AdminShopsPage } from "./pages/admin/ShopsPage";
import { AdminAdminsPage } from "./pages/admin/AdminsPage";
import { LegacyAdminUsersRedirect } from "./pages/admin/UsersPage";
import { MerchantUsersPage } from "./pages/merchant/UsersPage";
import { AdminLoginHistoryPage } from "./pages/admin/LoginHistoryPage";
import { MerchantLoginHistoryPage } from "./pages/merchant/LoginHistoryPage";
import { AdminRatesPage } from "./pages/admin/RatesPage";
import { AdminBooksPage } from "./pages/admin/BooksPage";
import { AdminReconPage } from "./pages/admin/ReconPage";
import { AdminLiquidityPage } from "./pages/admin/LiquidityPage";
import { LoginPage } from "./pages/shared/LoginPage";
import { AuthShell } from "./routes/AuthShell";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function App() {
  return (
    <TooltipProvider>
      <ViewerProvider>
        <BrowserRouter>
          <FilterProvider>
            <AccessMockProvider>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route element={<AuthShell />}>
                <Route path="/" element={<Navigate to="/payouts/overview" replace />} />
                <Route
                  path="/payouts/overview"
                  element={
                    <RolePage admin={<AdminOverviewPage />} merchant={<MerchantOverviewPage />} />
                  }
                />
                <Route
                  path="/payouts"
                  element={<RolePage admin={<AdminPayoutsPage />} merchant={<MerchantPayoutsPage />} />}
                />
                <Route
                  path="/payouts/batches"
                  element={
                    <AdminOnly>
                      <AdminBatchesPage />
                    </AdminOnly>
                  }
                />
                <Route
                  path="/payouts/batches/:batchId"
                  element={
                    <AdminOnly>
                      <AdminBatchDetailPage />
                    </AdminOnly>
                  }
                />
                <Route
                  path="/payouts/rates"
                  element={
                    <AdminOnly message="หน้าอัตราถอนสำหรับแพลตฟอร์มแอดมินเท่านั้น">
                      <AdminRatesPage />
                    </AdminOnly>
                  }
                />
                <Route
                  path="/payouts/books"
                  element={
                    <AdminOnly message="หน้าสมุดร้านสำหรับแพลตฟอร์มแอดมินเท่านั้น">
                      <AdminBooksPage />
                    </AdminOnly>
                  }
                />
                <Route
                  path="/payouts/recon"
                  element={
                    <AdminOnly message="หน้ากระทบยอดขาออกสำหรับแพลตฟอร์มแอดมินเท่านั้น">
                      <AdminReconPage />
                    </AdminOnly>
                  }
                />
                <Route
                  path="/payouts/liquidity"
                  element={
                    <AdminOnly message="หน้าบัญชีจ่ายสำหรับแพลตฟอร์มแอดมินเท่านั้น">
                      <AdminLiquidityPage />
                    </AdminOnly>
                  }
                />
                <Route
                  path="/shops"
                  element={
                    <AdminOnly message="หน้าจัดการร้านค้าสำหรับแพลตฟอร์มแอดมินเท่านั้น">
                      <AdminShopsPage />
                    </AdminOnly>
                  }
                />
                <Route
                  path="/shops/:merchantId"
                  element={
                    <AdminOnly message="หน้าจัดการร้านค้าสำหรับแพลตฟอร์มแอดมินเท่านั้น">
                      <AdminShopsPage />
                    </AdminOnly>
                  }
                />
                <Route
                  path="/admins"
                  element={
                    <AdminOnly message="หน้าแอดมินแพลตฟอร์มสำหรับแพลตฟอร์มแอดมินเท่านั้น">
                      <AdminAdminsPage />
                    </AdminOnly>
                  }
                />
                <Route
                  path="/users"
                  element={<RolePage admin={<LegacyAdminUsersRedirect />} merchant={<MerchantUsersPage />} />}
                />
                <Route
                  path="/users/:merchantId"
                  element={
                    <RolePage admin={<LegacyAdminUsersRedirect />} merchant={<Navigate to="/users" replace />} />
                  }
                />
                <Route
                  path="/login-history"
                  element={
                    <RolePage admin={<AdminLoginHistoryPage />} merchant={<MerchantLoginHistoryPage />} />
                  }
                />
                <Route path="/payouts/:referenceId" element={<PayoutDetailPage />} />
                </Route>
              </Routes>
            </AccessMockProvider>
          </FilterProvider>
        </BrowserRouter>
      </ViewerProvider>
    </TooltipProvider>
  );
}
