import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import { I18nProvider } from './i18n';
import AppShell from './AppShell';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import CompanyStockPage from './pages/CompanyStockPage';
import WarehouseMatrixPage from './pages/WarehouseMatrixPage';
import CustomsPage from './pages/CustomsPage';
import ClearedProductsPage from './pages/ClearedProductsPage';
import CatalogPage from './pages/CatalogPage';
import SalesPage from './pages/SalesPage';
import CertificatesPage from './pages/CertificatesPage';
import OperationsPage from './pages/OperationsPage';
import ProductDetailPage from './pages/ProductDetailPage';
import ErrorBoundary from './ErrorBoundary';

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
        <ErrorBoundary><BrowserRouter>
          <Routes>
            <Route path="/login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
            <Route
              path="/"
              element={<RequireAuth><AppShell /></RequireAuth>}
            >
              <Route index element={<DashboardPage />} />
              <Route path="company-stock" element={<CompanyStockPage />} />
              <Route path="warehouses" element={<WarehouseMatrixPage />} />
              <Route path="customs" element={<CustomsPage />} />
              <Route path="cleared" element={<ClearedProductsPage />} />
              <Route path="catalog" element={<CatalogPage />} />
              <Route path="sales" element={<SalesPage />} />
              <Route path="certificates" element={<CertificatesPage />} />
              <Route path="operations" element={<OperationsPage />} />
              <Route path="products/:productId" element={<ProductDetailPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter></ErrorBoundary>
      </AuthProvider>
    </I18nProvider>
  );
}
