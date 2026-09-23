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
  const isForm = init?.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
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
  role: 'sysadmin' | 'admin' | 'guest';
  username: string;
  displayName: string | null;
  expiresAt: number;
  canEditStock: boolean;
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const r = await request<{
    role: LoginResult['role']; username: string;
    display_name: string | null; expires_at: number; can_edit_stock: boolean;
  }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  return {
    role: r.role, username: r.username,
    displayName: r.display_name, expiresAt: r.expires_at, canEditStock: r.can_edit_stock,
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
  canEditStock: boolean;
}
export async function fetchMe(): Promise<Me> {
  const r = await request<{
    username: string; role: Me['role']; display_name: string | null;
    department: string | null; position: string | null; can_edit_stock: boolean;
  }>('/auth/me');
  return { username: r.username, role: r.role, displayName: r.display_name, department: r.department, position: r.position, canEditStock: r.can_edit_stock };
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
  customsQty: number; orderQty: number; incomingQty: number; avgSales: number;
  warehouseQty: number; coverageMonths: number | null; expiryDatesCount: number;
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
      customsQty: x.customs_qty, orderQty: x.order_qty, incomingQty: x.incoming_qty,
      avgSales: x.avg_sales,
      warehouseQty: x.warehouse_qty, coverageMonths: x.coverage_months,
      expiryDatesCount: x.expiry_dates_count,
    })),
  };
}

export async function setCompanyStock(productId: string, qty: number): Promise<void> {
  await request(`/company-stock/${productId}`, { method: 'PUT', body: JSON.stringify({ qty }) });
}

export interface WarehouseBreakdownRow {
  warehouseId: string; warehouseName: string; warehouseCode: string | null; quantity: number;
}
export interface WarehouseBreakdown {
  productId: string; productName: string; productGroup: string | null;
  totalStock: number; warehouses: WarehouseBreakdownRow[];
}
export async function warehouseBreakdown(productId: string): Promise<WarehouseBreakdown> {
  const r = await request<any>(`/company-stock/${productId}/warehouse-breakdown`);
  return {
    productId: r.product_id, productName: r.product_name, productGroup: r.product_group,
    totalStock: r.total_stock,
    warehouses: r.warehouses.map((w: any) => ({
      warehouseId: w.warehouse_id, warehouseName: w.warehouse_name,
      warehouseCode: w.warehouse_code, quantity: w.quantity,
    })),
  };
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

// ── Product × warehouse matrix ───────────────────────────────────────────────
export interface MatrixWarehouse { id: string; name: string; code: string | null; project: string | null; }
export interface MatrixProduct {
  productId: string; productName: string; productGroup: string | null;
  project: string | null; warehouseStocks: Record<string, number>;
}
export interface WarehouseMatrix { warehouses: MatrixWarehouse[]; products: MatrixProduct[]; }

export async function warehouseMatrix(): Promise<WarehouseMatrix> {
  const r = await request<any>('/warehouses/matrix');
  return {
    warehouses: r.warehouses.map((w: any) => ({ id: w.id, name: w.name, code: w.code, project: w.project })),
    products: r.products.map((p: any) => ({
      productId: p.product_id, productName: p.product_name, productGroup: p.product_group,
      project: p.project, warehouseStocks: p.warehouse_stocks || {},
    })),
  };
}

// ── Customs (flat product-level) ─────────────────────────────────────────────
export interface CustomsSeries { id: string; batch: string; qty: number; }
export interface CustomsProduct {
  id: string; invoiceId: string; productName: string; regime: string; category: string;
  qty: number; productExpiry: string | null; certificateStatus: string;
  hasCertificate: boolean; series: CustomsSeries[];
}
export interface CustomsList { items: CustomsProduct[]; totalInvoices: number; totalProducts: number; totalQty: number; }

export async function listCustoms(params: { q?: string; regime?: string }): Promise<CustomsList> {
  const r = await request<any>(`/customs/products${qs({ q: params.q, regime: params.regime })}`);
  return {
    totalInvoices: r.total_invoices, totalProducts: r.total_products, totalQty: r.total_qty,
    items: r.items.map((p: any) => ({
      id: p.id, invoiceId: p.invoice_id, productName: p.product_name, regime: p.regime,
      category: p.category, qty: p.qty, productExpiry: p.product_expiry,
      certificateStatus: p.certificate_status, hasCertificate: p.has_certificate,
      series: (p.series || []).map((s: any) => ({ id: s.id, batch: s.batch, qty: s.qty })),
    })),
  };
}

export async function customsCertificateUrl(invoiceId: string): Promise<string> {
  const r = await request<{ url: string }>(`/customs/invoices/${invoiceId}/certificate-url`);
  return r.url;
}

// ── Cleared goods ────────────────────────────────────────────────────────────
export interface ClearedRow {
  id: string; invoiceName: string; productName: string; seriesBatch: string | null;
  regime: string | null; qty: number; pallets: number | null; boxes: number | null;
  comment: string | null; clearedAt: string;
}
export interface ClearedList {
  items: ClearedRow[]; total: number; totalQty: number; totalPallets: number; totalBoxes: number;
}
export async function listCleared(params: { q?: string; regime?: string }): Promise<ClearedList> {
  const r = await request<any>(`/customs/cleared${qs({ q: params.q, regime: params.regime })}`);
  return {
    total: r.total, totalQty: r.total_qty, totalPallets: r.total_pallets, totalBoxes: r.total_boxes,
    items: r.items.map((x: any) => ({
      id: x.id, invoiceName: x.invoice_name, productName: x.product_name, seriesBatch: x.series_batch,
      regime: x.regime, qty: x.qty, pallets: x.pallets, boxes: x.boxes,
      comment: x.comment, clearedAt: x.cleared_at,
    })),
  };
}

export interface ProductExpiryRow {
  expiryDate: string | null; batchNumber: string | null; quantity: number;
}
export interface ProductExpiryBreakdown {
  productId: string; productName: string; sourceDate: string; totalQuantity: number;
  items: ProductExpiryRow[];
}
export async function productExpiryBreakdown(productId: string): Promise<ProductExpiryBreakdown> {
  const r = await request<any>(`/company-stock/${productId}/expiry-breakdown`);
  return {
    productId: r.product_id, productName: r.product_name, sourceDate: r.source_date,
    totalQuantity: r.total_quantity,
    items: r.items.map((item: any) => ({
      expiryDate: item.expiry_date, batchNumber: item.batch_number, quantity: item.quantity,
    })),
  };
}

// ── Certificate library (read-only) ─────────────────────────────────────────
export interface CertificateProductLink {
  productId: string | null;
  catalogName: string;
  tradeName: string;
  dosageForm: string | null;
}

export interface Certificate {
  id: string;
  certificateNumber: string;
  registrationDate: string | null;
  validUntil: string | null;
  tradeName: string;
  dosageForm: string | null;
  holderName: string | null;
  holderCountry: string | null;
  manufacturerName: string | null;
  manufacturerCountry: string | null;
  apiDetails: string | null;
  authorizedPerson: string | null;
  notes: string | null;
  productLinks: CertificateProductLink[];
  documentName: string | null;
  documentSizeBytes: number | null;
  documentMimeType: string | null;
  documentUploadedAt: string | null;
}

export async function listCertificates(): Promise<Certificate[]> {
  const rows = await request<any[]>('/certificates');
  return rows.map((row) => ({
    id: row.id,
    certificateNumber: row.certificate_number,
    registrationDate: row.registration_date,
    validUntil: row.valid_until,
    tradeName: row.trade_name,
    dosageForm: row.dosage_form,
    holderName: row.holder_name,
    holderCountry: row.holder_country,
    manufacturerName: row.manufacturer_name,
    manufacturerCountry: row.manufacturer_country,
    apiDetails: row.api_details,
    authorizedPerson: row.authorized_person,
    notes: row.notes,
    productLinks: (row.product_links || []).map((link: any) => ({
      productId: link.product_id,
      catalogName: link.catalog_name,
      tradeName: link.trade_name,
      dosageForm: link.dosage_form,
    })),
    documentName: row.document_name,
    documentSizeBytes: row.document_size_bytes,
    documentMimeType: row.document_mime_type,
    documentUploadedAt: row.document_uploaded_at,
  }));
}

export async function certificateDocumentUrl(certificateId: string): Promise<string> {
  const result = await request<{ url: string }>(`/certificates/${certificateId}/document-url`);
  return result.url;
}

// ── Sales ─────────────────────────────────────────────────────────────────────
export interface MonthlyPoint { month: string; dispatched: number; sold: number; }
export interface SalesOverview {
  months: MonthlyPoint[]; totalDispatched: number; totalSold: number;
  previousDispatched: number; previousSold: number; sellThroughRate: number | null;
}
export async function salesOverview(params: number | {
  months?: number; manufacturer?: string; projectId?: string; productId?: string;
} = 12): Promise<SalesOverview> {
  const options = typeof params === 'number' ? { months: params } : params;
  const r = await request<any>(`/sales/overview${qs({ months: options.months, manufacturer: options.manufacturer, project_id: options.projectId, product_id: options.productId })}`);
  return {
    totalDispatched: r.total_dispatched, totalSold: r.total_sold,
    previousDispatched: r.previous_dispatched, previousSold: r.previous_sold,
    sellThroughRate: r.sell_through_rate,
    months: r.months.map((m: any) => ({ month: m.month, dispatched: m.dispatched, sold: m.sold })),
  };
}

export interface ProductSalesRow {
  productId: string; name: string; manufacturerLabel: string | null; dispatched: number; sold: number;
  sellThroughRate: number | null; variance: number;
}
export async function topProducts(months = 6, limit = 20, filters: { manufacturer?: string; projectId?: string; q?: string } = {}): Promise<ProductSalesRow[]> {
  const r = await request<any>(`/sales/top-products${qs({ months, limit, manufacturer: filters.manufacturer, project_id: filters.projectId, q: filters.q })}`);
  return r.items.map((x: any) => ({
    productId: x.product_id, name: x.name, manufacturerLabel: x.manufacturer_label,
    dispatched: x.dispatched, sold: x.sold, sellThroughRate: x.sell_through_rate, variance: x.variance,
  }));
}

// ── Cross-module operations ─────────────────────────────────────────────────
export interface OrderRow {
  id: string; productId: string; productName: string; externalId: string | null;
  projectName: string | null; manufacturerLabel: string | null; month: string;
  qty: number; fileName: string | null; sizeBytes: number | null;
  mimeType: string | null; uploadedAt: string | null;
}
export interface OrderPage extends Page<OrderRow> { totalQty: number; }
export interface OrderLookups { groups: string[]; manufacturers: string[]; }
export async function orderLookups(): Promise<OrderLookups> { return request<OrderLookups>('/orders/lookups'); }
export async function listOrders(params: {
  q?: string; manufacturer?: string; group?: string; page?: number; pageSize?: number;
}): Promise<OrderPage> {
  const r = await request<any>(`/orders${qs({ q: params.q, manufacturer: params.manufacturer, group: params.group, page: params.page, page_size: params.pageSize })}`);
  return {
    total: r.total, totalQty: r.total_qty, page: r.page, pageSize: r.page_size,
    items: r.items.map((x: any) => ({
      id: x.id, productId: x.product_id, productName: x.product_name,
      externalId: x.external_id, projectName: x.project_name,
      manufacturerLabel: x.manufacturer_label, month: x.month, qty: x.qty,
      fileName: x.file_name, sizeBytes: x.size_bytes,
      mimeType: x.mime_type, uploadedAt: x.uploaded_at,
    })),
  };
}
export async function orderDocumentUrl(orderId: string): Promise<string> {
  const r = await request<{ url: string }>(`/orders/${orderId}/document-url`);
  return r.url;
}

export interface ExpirySnapshotInfo {
  source: string; importedAt: string; rowCount: number; aggregatedRowCount: number;
  productCount: number; totalQuantity: number;
  ageDays: number; isStale: boolean;
}
function mapSnapshot(r: any): ExpirySnapshotInfo {
  return { source: r.source, importedAt: r.imported_at, rowCount: r.row_count, aggregatedRowCount: r.aggregated_row_count, productCount: r.product_count, totalQuantity: r.total_quantity, ageDays: r.age_days, isStale: r.is_stale };
}
export async function expirySnapshotStatus(): Promise<ExpirySnapshotInfo> {
  return mapSnapshot(await request<any>('/operations/expiry/status'));
}
export async function importExpiryWorkbook(file: File): Promise<ExpirySnapshotInfo> {
  const body = new FormData();
  body.append('file', file);
  return mapSnapshot(await request<any>('/operations/expiry/import', { method: 'POST', body }));
}

export interface DashboardSummary {
  companyProducts: number; warehouses: number; customsPositions: number;
  dispatched12m: number; sold12m: number; expiringBatches: number; lowStockProducts: number;
  expirySnapshot: ExpirySnapshotInfo;
}
export async function dashboardSummary(): Promise<DashboardSummary> {
  const r = await request<any>('/operations/summary');
  return { companyProducts: r.company_products, warehouses: r.warehouses, customsPositions: r.customs_positions, dispatched12m: r.dispatched_12m, sold12m: r.sold_12m, expiringBatches: r.expiring_batches, lowStockProducts: r.low_stock_products, expirySnapshot: mapSnapshot(r.expiry_snapshot) };
}

export interface OperationalAlert {
  id: string; kind: string; severity: string; productId: string | null; productName: string;
  detail: string; quantity: number | null; date: string | null;
}
export async function listAlerts(): Promise<OperationalAlert[]> {
  const rows = await request<any[]>('/operations/alerts');
  return rows.map((r) => ({ id: r.id, kind: r.kind, severity: r.severity, productId: r.product_id, productName: r.product_name, detail: r.detail, quantity: r.quantity, date: r.date }));
}

export interface Recommendation {
  productId: string; productName: string; projectName: string | null; manufacturerLabel: string | null;
  avgMonthlySales: number; currentStock: number; customsStock: number; incomingStock: number;
  openOrders: number; coverageMonths: number | null; targetMonths: number; recommendedOrder: number;
}
export async function listRecommendations(targetMonths = 6): Promise<Recommendation[]> {
  const rows = await request<any[]>(`/operations/recommendations${qs({ target_months: targetMonths })}`);
  return rows.map((r) => ({ productId: r.product_id, productName: r.product_name, projectName: r.project_name, manufacturerLabel: r.manufacturer_label, avgMonthlySales: r.avg_monthly_sales, currentStock: r.current_stock, customsStock: r.customs_stock, incomingStock: r.incoming_stock, openOrders: r.open_orders, coverageMonths: r.coverage_months, targetMonths: r.target_months, recommendedOrder: r.recommended_order }));
}

export interface QualityIssue { id: string; kind: string; severity: string; productId: string | null; productName: string; detail: string; }
export async function listQualityIssues(): Promise<QualityIssue[]> {
  const rows = await request<any[]>('/operations/quality');
  return rows.map((r) => ({ id: r.id, kind: r.kind, severity: r.severity, productId: r.product_id, productName: r.product_name, detail: r.detail }));
}

export interface ProductDossier {
  product: { id: string; name: string; external_id: string | null; project_name: string | null; manufacturer_label: string | null; category: string | null; strength: string | null; dosage_form: string | null; country: string | null };
  companyStock: number; warehouses: { name: string; code: string | null; quantity: number }[];
  expiries: { product_code: string; product_name: string; expiry_date: string | null; batch_number: string | null; quantity: number }[];
  customs: { id: string; invoice: string; regime: string; quantity: number; expiry_date: string | null; series: { batch: string; quantity: number }[] }[];
  sales: MonthlyPoint[]; certificates: { id: string; number: string; valid_until: string | null; trade_name: string; has_document: boolean }[];
}
export async function productDossier(productId: string): Promise<ProductDossier> {
  const r = await request<any>(`/operations/products/${productId}`);
  return { product: r.product, companyStock: r.company_stock, warehouses: r.warehouses, expiries: r.expiries, customs: r.customs, sales: r.sales, certificates: r.certificates };
}

export interface AuditEvent { at: string; actor: string; action: string; target: string; details: Record<string, unknown>; }
export async function listAuditEvents(): Promise<AuditEvent[]> { return request<AuditEvent[]>('/operations/audit'); }
