import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { FilterProvider } from "./state/FilterProvider";
import { ViewerProvider } from "./state/ViewerProvider";
import { Shell } from "./layout/Shell";
import { AdminOnly } from "./layout/AdminOnly";
import { OverviewPage } from "./pages/OverviewPage";
import { PayoutsPage } from "./pages/PayoutsPage";
import { PayoutDetailPage } from "./pages/PayoutDetailPage";
import { BatchesPage } from "./pages/BatchesPage";
import { BatchDetailPage } from "./pages/BatchDetailPage";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function App() {
  return (
    <TooltipProvider>
      <FilterProvider>
        <ViewerProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Shell />}>
                <Route path="/" element={<Navigate to="/payouts/overview" replace />} />
                <Route path="/payouts/overview" element={<OverviewPage />} />
                <Route path="/payouts" element={<PayoutsPage />} />
                <Route
                  path="/payouts/batches"
                  element={
                    <AdminOnly>
                      <BatchesPage />
                    </AdminOnly>
                  }
                />
                <Route
                  path="/payouts/batches/:batchId"
                  element={
                    <AdminOnly>
                      <BatchDetailPage />
                    </AdminOnly>
                  }
                />
                <Route path="/payouts/:referenceId" element={<PayoutDetailPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ViewerProvider>
      </FilterProvider>
    </TooltipProvider>
  );
}
