import { useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Search, Check, Pencil, Warehouse, X, ArrowRight } from 'lucide-react';
import * as api from '../api';
import { useAuth } from '../AuthContext';
import { useLang } from '../i18n';
import { PageHead, Spinner, EmptyState, fmtNum } from '../components';

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
          <input placeholder={t('action.search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
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
          <div className="table-scroll">
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
                {data?.items.map((r) => (
                  <StockRow key={r.productId} row={r} canWrite={canWrite} onSaved={load} onOpen={() => setModalProduct(r)} />
                ))}
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

function StockRow({ row, canWrite, onSaved, onOpen }: {
  row: api.CompanyStockRow; canWrite: boolean; onSaved: () => void; onOpen: () => void;
}) {
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
          <span className="name">{row.name}</span>
          {row.catalogCategory && (
            <span className={`cat-chip ${catClass(row.catalogCategory)}`}>{row.catalogCategory}</span>
          )}
        </div>
      </td>
      <td>{row.projectName || '—'}</td>
      <td className="num">
        {editing ? (
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <input className="inline-edit" value={value} autoFocus
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} />
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}><Check size={15} /></button>
          </span>
        ) : (
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
            <button className={`stock-link ${row.qty > 0 ? '' : 'zero'}`} onClick={onOpen} title="Warehouse breakdown">
              {fmtNum(row.qty)}
            </button>
            {canWrite && (
              <button className="btn btn-ghost btn-sm" onClick={() => { setValue(String(row.qty)); setEditing(true); }}>
                <Pencil size={14} />
              </button>
            )}
          </span>
        )}
      </td>
      <td className="num">{row.customsQty > 0 ? <span className="qty-strong" style={{ fontSize: 15 }}>{fmtNum(row.customsQty)}</span> : '—'}</td>
      <td className="num">{row.incomingQty > 0 ? <span className="incoming-pill">+{fmtNum(row.incomingQty)}</span> : '—'}</td>
      <td className="num">{row.avgSales > 0 ? fmtNum(row.avgSales) : '—'}</td>
      <td className="num">
        {row.coverageMonths == null ? (
          <span className="cov-pill none">—</span>
        ) : (
          <button className={`cov-pill ${tone}`} onClick={onOpen} title="Warehouse breakdown">
            {row.coverageMonths.toFixed(1)}
          </button>
        )}
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="mh-title"><Warehouse size={22} className="mi" /> {t('modal.title')}</div>
          <button className="modal-close" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="modal-prod">{row.name}</div>
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
          <button className="btn btn-ghost" onClick={onClose}>{t('modal.close')}</button>
        </div>
      </div>
    </div>
  );
}

export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</button>
      <span>{page} / {pages}</span>
      <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>›</button>
    </span>
  );
}
