import { useEffect, useMemo, useState } from 'react';
import { Warehouse, Search, Layers } from 'lucide-react';
import * as api from '../api';
import { useLang } from '../i18n';
import { PageHead, Spinner, EmptyState, fmtNum } from '../components';

// Projects hidden from the Sales view.
const EXCLUDED = new Set(['kazakhstan', 'tadjikistan', 'tajikistan']);

interface Group {
  project: string;
  label: string;
  warehouses: api.MatrixWarehouse[];
  products: api.MatrixProduct[];
}

function groupMatrix(data: api.WarehouseMatrix, includeZero: boolean): Group[] {
  const byProject = new Map<string, api.MatrixWarehouse[]>();
  for (const w of data.warehouses) {
    const key = (w.project || '').trim();
    if (EXCLUDED.has(key.toLowerCase())) continue;
    const list = byProject.get(key) || [];
    list.push(w);
    byProject.set(key, list);
  }
  const keys = [...byProject.keys()].sort((a, b) => (!a ? 1 : !b ? -1 : a.localeCompare(b)));
  return keys.map((pk) => {
    const warehouses = byProject.get(pk) || [];
    const products = data.products.filter((p) => {
      if (warehouses.some((w) => (p.warehouseStocks[w.id] || 0) > 0)) return true;
      if (includeZero) {
        const g = (p.project || p.productGroup || '').trim().toLowerCase();
        return g === pk.toLowerCase();
      }
      return false;
    });
    return { project: pk, label: pk || '—', warehouses, products };
  });
}

export default function WarehouseMatrixPage() {
  const { t } = useLang();
  const [data, setData] = useState<api.WarehouseMatrix | null>(null);
  const [project, setProject] = useState('ALL');
  const [warehouseFilter, setWarehouseFilter] = useState('ALL');
  const [includeZero, setIncludeZero] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => { api.warehouseMatrix().then(setData).catch(() => setData({ warehouses: [], products: [] })); }, []);

  const groups = useMemo(() => (data ? groupMatrix(data, includeZero) : []), [data, includeZero]);

  const visibleGroups = useMemo(
    () => groups.filter((g) => project === 'ALL' || g.project.toLowerCase() === project.toLowerCase()),
    [groups, project],
  );

  // Warehouses available in the current project view (for the dropdown).
  const projectWarehouses = useMemo(() => {
    const seen = new Map<string, api.MatrixWarehouse>();
    for (const g of visibleGroups) for (const w of g.warehouses) seen.set(w.id, w);
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [visibleGroups]);

  // Reset warehouse filter if it's no longer valid for the chosen project.
  useEffect(() => {
    if (warehouseFilter !== 'ALL' && !projectWarehouses.some((w) => w.id === warehouseFilter)) {
      setWarehouseFilter('ALL');
    }
  }, [projectWarehouses, warehouseFilter]);

  if (!data) return <Spinner label={t('common.loading')} />;

  const search = q.trim().toLowerCase();

  return (
    <>
      <PageHead icon={<Warehouse size={24} />} title={t('wh.title')} sub={t('wh.sub')} />

      {/* Project tabs */}
      <div className="proj-tabs">
        <button className={`proj-tab ${project === 'ALL' ? 'active' : ''}`} onClick={() => setProject('ALL')}>
          <Layers size={16} /> {t('wh.allProjects')}
        </button>
        {groups.map((g) => (
          <button
            key={g.project || 'unassigned'}
            className={`proj-tab ${project.toLowerCase() === g.project.toLowerCase() ? 'active' : ''}`}
            onClick={() => setProject(g.project || 'ALL')}
          >
            <Warehouse size={16} /> {g.label}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <select className="field" value={warehouseFilter} onChange={(e) => setWarehouseFilter(e.target.value)}>
          <option value="ALL">{t('wh.allWarehouses')} ({projectWarehouses.length})</option>
          {projectWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <label className="chk">
          <input type="checkbox" checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)} />
          {t('wh.include0')}
        </label>
        <div className="search" style={{ marginLeft: 'auto', maxWidth: 340 }}>
          <Search size={18} />
          <input placeholder={t('action.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {visibleGroups.length === 0 ? (
        <div className="card"><EmptyState title={t('common.none')} /></div>
      ) : (
        visibleGroups.map((group) => {
          const cols = warehouseFilter === 'ALL'
            ? group.warehouses
            : group.warehouses.filter((w) => w.id === warehouseFilter);
          if (cols.length === 0) return null;
          const products = group.products.filter(
            (p) => !search || p.productName.toLowerCase().includes(search) || (p.productGroup || '').toLowerCase().includes(search),
          );
          return (
            <div className="card matrix-card" key={group.project || 'unassigned'}>
              <div className="matrix-head">
                <h3>{group.label}</h3>
                <span>{fmtNum(products.length)} {t('wh.products')} · {fmtNum(cols.length)} {t('nav.warehouses').toLowerCase()}</span>
              </div>
              {products.length === 0 ? (
                <EmptyState title={t('common.none')} />
              ) : (
                <div className="table-scroll frozen">
                  <table className="data matrix">
                    <thead>
                      <tr>
                        <th className="sticky-col">{t('common.product')}</th>
                        <th>{t('wh.group')}</th>
                        <th className="num">{t('wh.projectStock')}</th>
                        {cols.map((w) => <th key={w.id} className="num wh-col" title={w.name}>{w.name}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((p) => {
                        const total = cols.reduce((s, w) => s + (p.warehouseStocks[w.id] || 0), 0);
                        const foreign = group.project && p.productGroup
                          && p.productGroup.toLowerCase() !== group.project.toLowerCase();
                        return (
                          <tr key={p.productId}>
                            <td className="sticky-col cell-strong">{p.productName}</td>
                            <td>
                              {p.productGroup
                                ? <span className={`cat-chip ${foreign ? 'bad' : ''}`}>{p.productGroup}</span>
                                : '—'}
                            </td>
                            <td className="num"><span className="qty-strong" style={{ color: 'var(--primary-strong)' }}>{fmtNum(total)}</span></td>
                            {cols.map((w) => {
                              const qty = p.warehouseStocks[w.id] || 0;
                              return (
                                <td key={w.id} className="num" style={{ color: qty > 0 ? 'var(--text)' : 'var(--text-muted)', fontWeight: qty > 0 ? 700 : 400 }}>
                                  {qty > 0 ? fmtNum(qty) : '—'}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })
      )}
    </>
  );
}
