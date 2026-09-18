import { useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Search, Check, Pencil } from 'lucide-react';
import * as api from '../api';
import { useAuth } from '../AuthContext';
import { useLang } from '../i18n';
import { PageHead, Spinner, EmptyState, Chip, fmtNum } from '../components';

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
                  <th>{t('common.manufacturer')}</th>
                  <th>{t('common.project')}</th>
                  <th>{t('common.category')}</th>
                  <th className="num">{t('common.qty')}</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((r) => (
                  <StockRow key={r.productId} row={r} canWrite={canWrite} onSaved={load} />
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

function StockRow({ row, canWrite, onSaved }: { row: api.CompanyStockRow; canWrite: boolean; onSaved: () => void }) {
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

  return (
    <tr>
      <td>
        <div className="cell-strong">{row.name}</div>
      </td>
      <td>{row.manufacturerLabel || '—'}</td>
      <td>{row.projectName || '—'}</td>
      <td>{row.catalogCategory ? <Chip tone="slate">{row.catalogCategory}</Chip> : '—'}</td>
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
            <span className={`qty-strong ${row.qty > 0 ? '' : ''}`} style={{ color: row.qty > 0 ? 'var(--green)' : 'var(--text-muted)' }}>
              {fmtNum(row.qty)}
            </span>
            {canWrite && (
              <button className="btn btn-ghost btn-sm" onClick={() => { setValue(String(row.qty)); setEditing(true); }}>
                <Pencil size={14} />
              </button>
            )}
          </span>
        )}
      </td>
    </tr>
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
