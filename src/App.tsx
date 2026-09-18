import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import { I18nProvider } from './i18n';
import AppShell from './AppShell';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import CompanyStockPage from './pages/CompanyStockPage';
import WarehousesPage from './pages/WarehousesPage';
import WarehouseStockPage from './pages/WarehouseStockPage';
import CustomsPage from './pages/CustomsPage';
import CatalogPage from './pages/CatalogPage';
import SalesPage from './pages/SalesPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
            <Route
              path="/"
              element={<RequireAuth><AppShell /></RequireAuth>}
            >
              <Route index element={<DashboardPage />} />
              <Route path="company-stock" element={<CompanyStockPage />} />
              <Route path="warehouses" element={<WarehousesPage />} />
              <Route path="warehouses/:id" element={<WarehouseStockPage />} />
              <Route path="customs" element={<CustomsPage />} />
              <Route path="catalog" element={<CatalogPage />} />
              <Route path="sales" element={<SalesPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  );
}
