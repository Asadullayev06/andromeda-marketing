// Typed API client for the ANDROMEDA Sales backend.
// The wire is snake_case (FastAPI); we map to camelCase at the boundary here so
// pages/components only ever see camelCase.

import { authHeaders, clearAuth } from './auth';

// In production the frontend and backend are separate Coolify services on
// different domains, so point the client at the backend via a build-time env
// var (e.g. VITE_API_BASE_URL=https://api-marketing.andromeda-ai.uz). In dev
// this is unset and we fall back to '/api', which Vite proxies to :8010.
const BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init?.headers || {}),
    },
  });
  if (res.status === 401) {
    clearAuth();
    if (!location.pathname.startsWith('/login')) location.assign('/login');
    throw new ApiError(401, 'Session expired.');
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// ── Auth ───────────────────────────────────────────────────────────────────
export interface LoginResult {
  token: string;
  role: 'sysadmin' | 'admin' | 'guest';
  username: string;
  displayName: string | null;
  expiresAt: number;
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const r = await request<{
    token: string; role: LoginResult['role']; username: string;
    display_name: string | null; expires_at: number;
  }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  return {
    token: r.token, role: r.role, username: r.username,
    displayName: r.display_name, expiresAt: r.expires_at,
  };
}

export async function logout(): Promise<void> {
  try {
    await request('/auth/logout', { method: 'POST' });
  } catch {
    /* best-effort */
  }
}

export interface Me {
  username: string;
  role: LoginResult['role'] | null;
  displayName: string | null;
  department: string | null;
  position: string | null;
}
export async function fetchMe(): Promise<Me> {
  const r = await request<{
    username: string; role: Me['role']; display_name: string | null;
    department: string | null; position: string | null;
  }>('/auth/me');
  return { username: r.username, role: r.role, displayName: r.display_name, department: r.department, position: r.position };
}

// ── Catalog ─────────────────────────────────────────────────────────────────
export interface Product {
  id: string; name: string; externalId: string | null; productGroup: string | null;
  projectId: string | null; projectName: string | null; manufacturerLabel: string | null;
  strength: string | null; dosageForm: string | null; country: string | null; catalogCategory: string | null;
}
export interface Page<T> { items: T[]; total: number; page: number; pageSize: number; }

export async function listProducts(params: {
  q?: string; manufacturer?: string; projectId?: string; category?: string; page?: number; pageSize?: number;
}): Promise<Page<Product>> {
  const r = await request<{ items: any[]; total: number; page: number; page_size: number }>(
    `/catalog/products${qs({ q: params.q, manufacturer: params.manufacturer, project_id: params.projectId, category: params.category, page: params.page, page_size: params.pageSize })}`,
  );
  return {
    total: r.total, page: r.page, pageSize: r.page_size,
    items: r.items.map((p) => ({
      id: p.id, name: p.name, externalId: p.external_id, productGroup: p.product_group,
      projectId: p.project_id, projectName: p.project_name, manufacturerLabel: p.manufacturer_label,
      strength: p.strength, dosageForm: p.dosage_form, country: p.country, catalogCategory: p.catalog_category,
    })),
  };
}

export interface Lookups { manufacturers: string[]; projects: { id: string; name: string }[]; categories: string[]; }
export async function fetchLookups(): Promise<Lookups> {
  return request<Lookups>('/catalog/lookups');
}

// ── Company stock ────────────────────────────────────────────────────────────
export interface CompanyStockRow {
  productId: string; name: string; manufacturerLabel: string | null;
  projectName: string | null; catalogCategory: string | null; qty: number;
}
export interface CompanyStockPage extends Page<CompanyStockRow> { productsInStock: number; }

export async function listCompanyStock(params: {
  q?: string; manufacturer?: string; projectId?: string; onlyInStock?: boolean; page?: number; pageSize?: number;
}): Promise<CompanyStockPage> {
  const r = await request<any>(
    `/company-stock${qs({ q: params.q, manufacturer: params.manufacturer, project_id: params.projectId, only_in_stock: params.onlyInStock, page: params.page, page_size: params.pageSize })}`,
  );
  return {
    total: r.total, page: r.page, pageSize: r.page_size, productsInStock: r.products_in_stock,
    items: r.items.map((x: any) => ({
      productId: x.product_id, name: x.name, manufacturerLabel: x.manufacturer_label,
      projectName: x.project_name, catalogCategory: x.catalog_category, qty: x.qty,
    })),
  };
}

export async function setCompanyStock(productId: string, qty: number): Promise<void> {
  await request(`/company-stock/${productId}`, { method: 'PUT', body: JSON.stringify({ qty }) });
}

// ── Warehouses ────────────────────────────────────────────────────────────────
export interface WarehouseRow {
  id: string; name: string; code: string | null; projectName: string | null;
  warehouseType: string | null; city: string | null; isActive: boolean;
  productCount: number; totalQty: number;
}
export async function listWarehouses(includeInactive = false): Promise<WarehouseRow[]> {
  const r = await request<any[]>(`/warehouses${qs({ include_inactive: includeInactive })}`);
  return r.map((w) => ({
    id: w.id, name: w.name, code: w.code, projectName: w.project_name,
    warehouseType: w.warehouse_type, city: w.city, isActive: w.is_active,
    productCount: w.product_count, totalQty: w.total_qty,
  }));
}

export interface WarehouseStockRow {
  productId: string; name: string; manufacturerLabel: string | null; projectName: string | null; quantity: number;
}
export interface WarehouseStockPage extends Page<WarehouseStockRow> { warehouse: WarehouseRow; }
export async function warehouseStock(warehouseId: string, params: {
  q?: string; onlyInStock?: boolean; page?: number; pageSize?: number;
}): Promise<WarehouseStockPage> {
  const r = await request<any>(
    `/warehouses/${warehouseId}/stock${qs({ q: params.q, only_in_stock: params.onlyInStock, page: params.page, page_size: params.pageSize })}`,
  );
  const w = r.warehouse;
  return {
    total: r.total, page: r.page, pageSize: r.page_size,
    warehouse: {
      id: w.id, name: w.name, code: w.code, projectName: w.project_name,
      warehouseType: w.warehouse_type, city: w.city, isActive: w.is_active,
      productCount: w.product_count, totalQty: w.total_qty,
    },
    items: r.items.map((x: any) => ({
      productId: x.product_id, name: x.name, manufacturerLabel: x.manufacturer_label,
      projectName: x.project_name, quantity: x.quantity,
    })),
  };
}

export async function setWarehouseStock(warehouseId: string, productId: string, quantity: number): Promise<void> {
  await request(`/warehouses/${warehouseId}/stock/${productId}`, { method: 'PUT', body: JSON.stringify({ quantity }) });
}

// ── Customs ───────────────────────────────────────────────────────────────────
export interface CustomsSeries { id: string; batch: string; qty: number; }
export interface CustomsProduct {
  id: string; productName: string; regime: string; category: string; qty: number;
  invoiceSum: number; currency: string; productExpiry: string | null;
  bruttoKg: number | null; nettoKg: number | null; series: CustomsSeries[];
}
export interface CustomsInvoice {
  id: string; name: string; supplierLabel: string; regimeExpiry: string | null;
  invoiceCost: number; invoiceCurrency: string; logisticCost: number; currency: string;
  certificateStatus: string; totalQty: number; productCount: number; products: CustomsProduct[];
}
export interface CustomsList { items: CustomsInvoice[]; totalInvoices: number; totalProducts: number; totalQty: number; }

function mapCustomsInvoice(inv: any): CustomsInvoice {
  return {
    id: inv.id, name: inv.name, supplierLabel: inv.supplier_label, regimeExpiry: inv.regime_expiry,
    invoiceCost: inv.invoice_cost, invoiceCurrency: inv.invoice_currency, logisticCost: inv.logistic_cost,
    currency: inv.currency, certificateStatus: inv.certificate_status, totalQty: inv.total_qty,
    productCount: inv.product_count,
    products: (inv.products || []).map((p: any) => ({
      id: p.id, productName: p.product_name, regime: p.regime, category: p.category, qty: p.qty,
      invoiceSum: p.invoice_sum, currency: p.currency, productExpiry: p.product_expiry,
      bruttoKg: p.brutto_kg, nettoKg: p.netto_kg,
      series: (p.series || []).map((s: any) => ({ id: s.id, batch: s.batch, qty: s.qty })),
    })),
  };
}

export async function listCustoms(params: { q?: string; regime?: string }): Promise<CustomsList> {
  const r = await request<any>(`/customs${qs({ q: params.q, regime: params.regime })}`);
  return {
    totalInvoices: r.total_invoices, totalProducts: r.total_products, totalQty: r.total_qty,
    items: r.items.map(mapCustomsInvoice),
  };
}

// ── Sales ─────────────────────────────────────────────────────────────────────
export interface MonthlyPoint { month: string; dispatched: number; sold: number; }
export interface SalesOverview { months: MonthlyPoint[]; totalDispatched: number; totalSold: number; }
export async function salesOverview(months = 12): Promise<SalesOverview> {
  const r = await request<any>(`/sales/overview${qs({ months })}`);
  return {
    totalDispatched: r.total_dispatched, totalSold: r.total_sold,
    months: r.months.map((m: any) => ({ month: m.month, dispatched: m.dispatched, sold: m.sold })),
  };
}

export interface ProductSalesRow { productId: string; name: string; manufacturerLabel: string | null; dispatched: number; sold: number; }
export async function topProducts(months = 6, limit = 20): Promise<ProductSalesRow[]> {
  const r = await request<any>(`/sales/top-products${qs({ months, limit })}`);
  return r.items.map((x: any) => ({
    productId: x.product_id, name: x.name, manufacturerLabel: x.manufacturer_label,
    dispatched: x.dispatched, sold: x.sold,
  }));
}
