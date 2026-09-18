import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Warehouse, Search, ChevronLeft, Check, Pencil, Boxes, Package } from 'lucide-react';
import * as api from '../api';
import { useAuth } from '../AuthContext';
import { useLang } from '../i18n';
import { PageHead, Spinner, EmptyState, Stat, fmtNum } from '../components';
import { Pager } from './CompanyStockPage';

export default function WarehouseStockPage() {
  const { t } = useLang();
  const { canWrite } = useAuth();
  const nav = useNavigate();
  const { id = '' } = useParams();
  const [q, setQ] = useState('');
  const [onlyInStock, setOnlyInStock] = useState(true);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<api.WarehouseStockPage | null>(null);
  const [loading, setLoading] = useState(true);
  const debounce = useRef<number | undefined>(undefined);

  const load = useMemo(() => async () => {
    setLoading(true);
    try {
      const res = await api.warehouseStock(id, { q, onlyInStock, page, pageSize: 50 });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [id, q, onlyInStock, page]);

  useEffect(() => {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(load, 250);
    return () => window.clearTimeout(debounce.current);
  }, [load]);

  const w = data?.warehouse;

  return (
    <>
      <button className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }} onClick={() => nav('/warehouses')}>
        <ChevronLeft size={16} /> {t('wh.back')}
      </button>
      <PageHead icon={<Warehouse size={24} />} title={w?.name || t('wh.title')} sub={w?.projectName || t('wh.sub')} />

      {w && (
        <div className="stat-grid">
          <Stat tone="blue" icon={<Package size={24} />} label={t('wh.products')} value={fmtNum(w.productCount)} />
          <Stat tone="green" icon={<Boxes size={24} />} label={t('wh.units')} value={fmtNum(w.totalQty)} />
        </div>
      )}

      <div className="filter-row">
        <button className={`pill ${onlyInStock ? 'active' : ''}`} onClick={() => { setOnlyInStock(true); setPage(1); }}>
          {t('common.inStock')}
        </button>
        <button className={`pill ${!onlyInStock ? 'active' : ''}`} onClick={() => { setOnlyInStock(false); setPage(1); }}>
          {t('action.all')}
        </button>
        <div className="search" style={{ marginLeft: 'auto', maxWidth: 320 }}>
          <Search size={18} />
          <input placeholder={t('action.search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
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
                  <th>{t('common.manufacturer')}</th>
                  <th>{t('common.project')}</th>
                  <th className="num">{t('common.qty')}</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((r) => (
                  <WhRow key={r.productId} warehouseId={id} row={r} canWrite={canWrite} onSaved={load} />
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
    </>
  );
}

function WhRow({ warehouseId, row, canWrite, onSaved }: {
  warehouseId: string; row: api.WarehouseStockRow; canWrite: boolean; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(row.quantity));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.setWarehouseStock(warehouseId, row.productId, Number(value) || 0);
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td><div className="cell-strong">{row.name}</div></td>
      <td>{row.manufacturerLabel || '—'}</td>
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
          <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end' }}>
            <span className="qty-strong" style={{ color: row.quantity > 0 ? 'var(--green)' : 'var(--text-muted)' }}>
              {fmtNum(row.quantity)}
            </span>
            {canWrite && (
              <button className="btn btn-ghost btn-sm" onClick={() => { setValue(String(row.quantity)); setEditing(true); }}>
                <Pencil size={14} />
              </button>
            )}
          </span>
        )}
      </td>
    </tr>
  );
}
