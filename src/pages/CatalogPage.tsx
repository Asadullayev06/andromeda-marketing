import { Input } from "@/components/ui/input";
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as api from '../api';
import { useLang } from '../i18n';
import { PageHead, Spinner, EmptyState, Chip, fmtNum } from '../components';
import { Pager } from './CompanyStockPage';
import { SortTh, useTableSort } from '../tableSort';

export default function CatalogPage() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const sort = useTableSort<'name' | 'manufacturer' | 'project' | 'category' | 'country'>('name');
  const changeSort = (key: typeof sort.key) => { sort.toggle(key); setPage(1); };
  const [data, setData] = useState<api.Page<api.Product> | null>(null);
  const [loading, setLoading] = useState(true);
  const [lookups, setLookups] = useState<api.Lookups | null>(null);
  const debounce = useRef<number | undefined>(undefined);

  useEffect(() => { api.fetchLookups().then(setLookups).catch(() => {}); }, []);

  const load = useMemo(() => async () => {
    setLoading(true);
    try {
      setData(await api.listProducts({ q, manufacturer, category, page, pageSize: 50, sortBy: sort.key, sortDir: sort.direction }));
    } finally {
      setLoading(false);
    }
  }, [q, manufacturer, category, page, sort.key, sort.direction]);

  useEffect(() => {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(load, 250);
    return () => window.clearTimeout(debounce.current);
  }, [load]);

  return (
    <>
      <PageHead icon={<BookOpen size={24} />} title={t('catalog.title')} sub={t('catalog.sub')} />

      <div className="toolbar">
        <div className="search">
          <Search size={18} />
          <Input placeholder={t('action.search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <select className="field" value={manufacturer} onChange={(e) => { setManufacturer(e.target.value); setPage(1); }}>
          <option value="">{t('common.manufacturer')}: {t('action.all')}</option>
          {lookups?.manufacturers.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className="field" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
          <option value="">{t('common.category')}: {t('action.all')}</option>
          {lookups?.categories.map((c) => <option key={c} value={c}>{c}</option>)}
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
                  <SortTh label={t('common.product')} column="name" sort={{ ...sort, toggle: changeSort }} />
                  <SortTh label={t('common.manufacturer')} column="manufacturer" sort={{ ...sort, toggle: changeSort }} />
                  <SortTh label={t('common.project')} column="project" sort={{ ...sort, toggle: changeSort }} />
                  <SortTh label={t('common.category')} column="category" sort={{ ...sort, toggle: changeSort }} />
                  <SortTh label={t('common.country')} column="country" sort={{ ...sort, toggle: changeSort }} />
                </tr>
              </thead>
              <tbody>
                {data?.items.map((p) => (
                  <tr key={p.id} className="click-row" onClick={() => navigate(`/products/${p.id}`)}>
                    <td>
                      <div className="cell-strong">{p.name}</div>
                      {(p.strength || p.dosageForm) && (
                        <div className="cell-sub">{[p.strength, p.dosageForm].filter(Boolean).join(' · ')}</div>
                      )}
                    </td>
                    <td>{p.manufacturerLabel || '—'}</td>
                    <td>{p.projectName || '—'}</td>
                    <td>{p.catalogCategory ? <Chip tone="slate">{p.catalogCategory}</Chip> : '—'}</td>
                    <td>{p.country || '—'}</td>
                  </tr>
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
