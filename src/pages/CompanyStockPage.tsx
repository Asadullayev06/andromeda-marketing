import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Search, Check, Pencil, X, ArrowRight, ChevronDown, ChevronRight, CalendarDays } from 'lucide-react';
import * as api from '../api';
import { useAuth } from '../AuthContext';
import { useLang } from '../i18n';
import { PageHead, Spinner, EmptyState, fmtNum, fmtDate } from '../components';

function catClass(cat: string | null): string {
  const c = (cat || '').toLowerCase();
  if (c === 'ls') return 'ls';
  if (c === 'cosmetic') return 'cosmetic';
  if (c.includes('бад') || c === 'bad') return 'bad';
  if (c.includes('device')) return 'device';
  return '';
}

function covTone(months: number | null): 'healthy' | 'risk' | 'none' {
  if (months == null) return 'none';
  return months > 4 ? 'healthy' : 'risk';
}

export default function CompanyStockPage() {
  const { t } = useLang();
  const { canWrite } = useAuth();
  const [q, setQ] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [projectId, setProjectId] = useState('');
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<api.CompanyStockPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [lookups, setLookups] = useState<api.Lookups | null>(null);
  const [modalProduct, setModalProduct] = useState<api.CompanyStockRow | null>(null);
  const [openExpiries, setOpenExpiries] = useState<Record<string, boolean>>({});
  const debounce = useRef<number | undefined>(undefined);

  useEffect(() => { api.fetchLookups().then(setLookups).catch(() => {}); }, []);

  const load = useMemo(() => async () => {
    setLoading(true);
    try {
      const res = await api.listCompanyStock({ q, manufacturer, projectId, onlyInStock, page, pageSize: 50 });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [q, manufacturer, projectId, onlyInStock, page]);

  useEffect(() => {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(load, 250);
    return () => window.clearTimeout(debounce.current);
  }, [load]);

  return (
    <>
      <PageHead icon={<Boxes size={24} />} title={t('company.title')} sub={t('company.sub')} />

      <div className="filter-row">
        <button className={`pill ${!onlyInStock ? 'active' : ''}`} onClick={() => { setOnlyInStock(false); setPage(1); }}>
          {t('action.all')}<span className="count">{fmtNum(data?.total ?? 0)}</span>
        </button>
        <button className={`pill ${onlyInStock ? 'active' : ''}`} onClick={() => { setOnlyInStock(true); setPage(1); }}>
          {t('common.inStock')}<span className="count green">{fmtNum(data?.productsInStock ?? 0)}</span>
        </button>
      </div>

      <div className="toolbar">
        <div className="search">
          <Search size={18} />
          <Input placeholder={t('action.search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <select className="field" value={manufacturer} onChange={(e) => { setManufacturer(e.target.value); setPage(1); }}>
          <option value="">{t('common.manufacturer')}: {t('action.all')}</option>
          {lookups?.manufacturers.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className="field" value={projectId} onChange={(e) => { setProjectId(e.target.value); setPage(1); }}>
          <option value="">{t('common.project')}: {t('action.all')}</option>
          {lookups?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {loading && !data ? (
        <Spinner label={t('common.loading')} />
      ) : data && data.items.length === 0 ? (
        <div className="table-wrap"><EmptyState title={t('common.none')} /></div>
      ) : (
        <div className="table-wrap">
          <div className="table-scroll frozen">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('common.product')}</th>
                  <th>{t('common.project')}</th>
                  <th className="num">{t('common.qty')}</th>
                  <th className="num">{t('company.customs')}</th>
                  <th className="num">{t('company.order')}</th>
                  <th className="num">{t('company.avgSales')}</th>
                  <th className="num">{t('company.forecast')}</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((r) => {
                  const isOpen = !!openExpiries[r.productId];
                  return (
                    <Fragment key={r.productId}>
                      <StockRow
                        row={r}
                        canWrite={canWrite}
                        isOpen={isOpen}
                        onToggle={() => setOpenExpiries((current) => ({ ...current, [r.productId]: !current[r.productId] }))}
                        onSaved={load}
                        onOpen={() => setModalProduct(r)}
                      />
                      {isOpen && <ProductExpiryDetails row={r} />}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <span>{fmtNum(data?.total ?? 0)} {t('common.results')}</span>
            <Pager page={page} total={data?.total ?? 0} pageSize={50} onPage={setPage} />
          </div>
        </div>
      )}

      {modalProduct && (
        <WarehouseBreakdownModal row={modalProduct} onClose={() => setModalProduct(null)} />
      )}
    </>
  );
}

function StockRow({ row, canWrite, isOpen, onToggle, onSaved, onOpen }: {
  row: api.CompanyStockRow; canWrite: boolean; isOpen: boolean; onToggle: () => void;
  onSaved: () => void; onOpen: () => void;
}) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(row.qty));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.setCompanyStock(row.productId, Number(value) || 0);
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const tone = covTone(row.coverageMonths);

  return (
    <tr>
      <td>
        <div className="prod-cell">
          <button className="product-expiry-trigger" type="button" onClick={onToggle} aria-expanded={isOpen}>
            {isOpen ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
            <span className="name">{row.name}</span>
          </button>
          {row.catalogCategory && (
            <span className={`cat-chip ${catClass(row.catalogCategory)}`}>{row.catalogCategory}</span>
          )}
          {row.expiryDatesCount > 0 && (
            <span className="expiry-count"><CalendarDays size={13} /> {row.expiryDatesCount}</span>
          )}
        </div>
      </td>
      <td>{row.projectName || '—'}</td>
      <td className="num">
        {editing ? (
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <Input aria-label={t('common.qty')} className="inline-edit" value={value} autoFocus
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} />
            <Button variant="default" size="sm" aria-label={t('action.save')} onClick={save} disabled={saving}><Check data-icon="inline-start" /></Button>
          </span>
        ) : (
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
            <button className={`stock-link ${row.qty > 0 ? '' : 'zero'}`} onClick={onOpen} title="Warehouse breakdown">
              {fmtNum(row.qty)}
            </button>
            {canWrite && (
              <Button variant="ghost" size="sm" aria-label={t('action.edit')} onClick={() => { setValue(String(row.qty)); setEditing(true); }}>
                <Pencil data-icon="inline-start" />
              </Button>
            )}
          </span>
        )}
      </td>
      <td className="num">{row.customsQty > 0 ? <span className="qty-strong" style={{ fontSize: 15 }}>{fmtNum(row.customsQty)}</span> : '—'}</td>
      <td className="num">
        {row.orderQty > 0 || row.incomingQty > 0 ? (
          <span className="orders-cell">
            {row.orderQty > 0 && <span className="order-main">{fmtNum(row.orderQty)}</span>}
            {row.incomingQty > 0 && <span className="incoming-pill">+{fmtNum(row.incomingQty)}</span>}
          </span>
        ) : '—'}
      </td>
      <td className="num">{row.avgSales > 0 ? fmtNum(row.avgSales) : '—'}</td>
      <td className="num">
        {row.coverageMonths == null ? '—' : (
          <span className={`cov-pill ${tone}`}>{row.coverageMonths.toFixed(1)}</span>
        )}
      </td>
    </tr>
  );
}

function ProductExpiryDetails({ row }: { row: api.CompanyStockRow }) {
  const { t } = useLang();
  const [data, setData] = useState<api.ProductExpiryBreakdown | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.productExpiryBreakdown(row.productId)
      .then((result) => { if (alive) setData(result); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [row.productId]);

  const groups = useMemo(() => {
    const grouped = new Map<string, api.ProductExpiryRow[]>();
    for (const item of data?.items ?? []) {
      const key = item.expiryDate ?? '';
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return [...grouped.entries()];
  }, [data]);

  return (
    <tr className="subtable expiry-subtable">
      <td colSpan={7}>
        <div className="subtable-inner expiry-details">
          {loading ? (
            <Spinner label={t('common.loading')} />
          ) : !data || data.items.length === 0 ? (
            <div className="expiry-empty">{t('company.expiry.none')}</div>
          ) : (
            <>
              <div className="expiry-summary">
                <span>{t('company.expiry.title')}</span>
                <span>{t('company.expiry.snapshot')}: {fmtDate(data.sourceDate)}</span>
              </div>
              <div className="expiry-groups">
                {groups.map(([expiryDate, items]) => (
                  <section className="expiry-group" key={expiryDate || 'unknown'}>
                    <div className="expiry-date">
                      <CalendarDays size={16} />
                      <span>{expiryDate ? fmtDate(expiryDate) : t('company.expiry.unknown')}</span>
                    </div>
                    <div className="series-chips">
                      {items.map((item, index) => (
                        <span className="series-chip" key={`${item.batchNumber ?? 'none'}-${index}`}>
                          {item.batchNumber || t('company.expiry.noBatch')} · <b>{fmtNum(item.quantity)}</b>
                        </span>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function WarehouseBreakdownModal({ row, onClose }: { row: api.CompanyStockRow; onClose: () => void }) {
  const { t } = useLang();
  const [data, setData] = useState<api.WarehouseBreakdown | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.warehouseBreakdown(row.productId)
      .then((d) => { if (alive) setData(d); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [row.productId]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[640px]" showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>{t('modal.title')}</DialogTitle>
            <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label={t('modal.close')} />}><X /></DialogClose>
          </div>
          <DialogDescription>{row.name}</DialogDescription>
        </DialogHeader>
        <div className="modal-sub">
          {data?.productGroup ? `${t('modal.group')}: ${data.productGroup}` : (row.projectName ? `${t('modal.group')}: ${row.projectName}` : '')}
        </div>

        {loading ? (
          <Spinner label={t('common.loading')} />
        ) : !data || data.warehouses.length === 0 ? (
          <EmptyState title={t('common.none')} />
        ) : (
          <>
            <div className="modal-total">
              <span className="mt-label">{t('modal.total')}:</span>
              <span className="mt-value">{fmtNum(data.totalStock)}</span>
            </div>
            <div className="table-wrap">
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('modal.warehouse')}</th>
                      <th>{t('modal.code')}</th>
                      <th className="num">{t('modal.qty')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.warehouses.map((w) => (
                      <tr key={w.warehouseId} className={w.quantity > 0 ? 'row-highlight' : ''}>
                        <td className="cell-strong">{w.warehouseName}</td>
                        <td>{w.warehouseCode ? <span className="code-chip">{w.warehouseCode}</span> : '—'}</td>
                        <td className="num"><span className="qty-strong">{fmtNum(w.quantity)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        <div className="modal-foot">
          <a href="/warehouses">{t('modal.open')} <ArrowRight size={14} style={{ verticalAlign: 'middle' }} /></a>
          <Button variant="ghost" onClick={onClose}>{t('modal.close')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</Button>
      <span>{page} / {pages}</span>
      <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>›</Button>
    </span>
  );
}
