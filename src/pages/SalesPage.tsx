import { useCallback, useEffect, useState } from 'react';
import { Download, Search, ShoppingCart, TrendingUp, Send } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import * as api from '../api';
import { downloadCsv } from '../export';
import { useLang } from '../i18n';
import { PageHead, Spinner, EmptyState, Stat, GroupedBars, fmtNum, fmtMonth } from '../components';

function change(current: number, previous: number): string {
  if (previous <= 0) return '—';
  const value = (current - previous) / previous * 100;
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

export default function SalesPage() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<api.SalesOverview | null>(null);
  const [top, setTop] = useState<api.ProductSalesRow[] | null>(null);
  const [lookups, setLookups] = useState<api.Lookups | null>(null);
  const [months, setMonths] = useState(12);
  const [manufacturer, setManufacturer] = useState('');
  const [projectId, setProjectId] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { api.fetchLookups().then(setLookups).catch(() => setLookups({ manufacturers: [], projects: [], categories: [] })); }, []);
  const load = useCallback(async () => {
    setError(''); setOverview(null); setTop(null);
    try {
      const [ov, rows] = await Promise.all([
        api.salesOverview({ months, manufacturer, projectId }),
        api.topProducts(months, 200, { manufacturer, projectId, q: query }),
      ]);
      setOverview(ov); setTop(rows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('common.error'));
      setOverview({ months: [], totalDispatched: 0, totalSold: 0, previousDispatched: 0, previousSold: 0, sellThroughRate: null });
      setTop([]);
    }
  }, [manufacturer, months, projectId, query, t]);
  useEffect(() => { const id = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(id); }, [load]);

  if (!overview || !top) return <Spinner label={t('common.loading')} />;
  const exportRows = () => downloadCsv('sales-analysis.csv', ['Product', 'Manufacturer', 'Dispatched', 'Sold', 'Sell-through %', 'Variance'], top.map((p) => [p.name, p.manufacturerLabel, p.dispatched, p.sold, p.sellThroughRate, p.variance]));
  return <>
    <PageHead icon={<TrendingUp size={24} />} title={t('sales.title')} sub={t('sales.sub')} actions={<Button variant="outline" onClick={exportRows}><Download data-icon="inline-start" />{t('action.export')}</Button>} />
    <div className="toolbar">
      <div className="search"><Search size={18} /><Input placeholder={t('action.search')} value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      <select className="field" value={months} onChange={(e) => setMonths(Number(e.target.value))}>{[3, 6, 12, 24, 36].map((value) => <option key={value} value={value}>{value} {t('company.months')}</option>)}</select>
      <select className="field" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)}><option value="">{t('common.manufacturer')}: {t('action.all')}</option>{lookups?.manufacturers.map((value) => <option key={value}>{value}</option>)}</select>
      <select className="field" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">{t('common.project')}: {t('action.all')}</option>{lookups?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    </div>
    {error && <div className="login-error">{error}</div>}
    <div className="stat-grid">
      <Stat tone="blue" icon={<Send size={24} />} label={t('sales.dispatched')} value={fmtNum(overview.totalDispatched)} hint={change(overview.totalDispatched, overview.previousDispatched)} />
      <Stat tone="green" icon={<ShoppingCart size={24} />} label={t('sales.sold')} value={fmtNum(overview.totalSold)} hint={change(overview.totalSold, overview.previousSold)} />
      <Stat tone="violet" icon={<TrendingUp size={24} />} label={t('sales.sellThrough')} value={overview.sellThroughRate == null ? '—' : `${overview.sellThroughRate.toFixed(1)}%`} hint={`${months} ${t('company.months')}`} />
    </div>
    <div className="card" style={{ marginBottom: 20 }}><div className="card-title">{t('dash.salesTrend')}</div>{overview.months.length ? <GroupedBars data={overview.months.map((m) => ({ label: fmtMonth(m.month), a: m.dispatched, b: m.sold }))} labels={[t('sales.dispatched'), t('sales.sold')]} colorA="#2f6bff" colorB="#22c55e" height={300} /> : <EmptyState title={t('common.none')} />}</div>
    <div className="card"><div className="card-title">{t('dash.topProducts')}</div>{top.length ? <div className="table-scroll"><table className="data" style={{ boxShadow: 'none' }}><thead><tr><th>{t('common.product')}</th><th>{t('common.manufacturer')}</th><th className="num">{t('sales.dispatched')}</th><th className="num">{t('sales.sold')}</th><th className="num">{t('sales.sellThrough')}</th><th className="num">{t('sales.variance')}</th></tr></thead><tbody>{top.map((p) => <tr key={p.productId} className="click-row" onClick={() => navigate(`/products/${p.productId}`)}><td className="cell-strong">{p.name}</td><td>{p.manufacturerLabel || '—'}</td><td className="num">{fmtNum(p.dispatched)}</td><td className="num">{fmtNum(p.sold)}</td><td className="num">{p.sellThroughRate == null ? '—' : `${p.sellThroughRate.toFixed(1)}%`}</td><td className={`num ${p.variance < 0 ? 'negative' : 'positive'}`}>{fmtNum(p.variance)}</td></tr>)}</tbody></table></div> : <EmptyState title={t('common.none')} />}</div>
  </>;
}
