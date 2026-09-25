import { useEffect, useState } from 'react';
import { Download, FileText, Package, RefreshCw, Search, ShoppingCart } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import * as api from '../api';
import { EmptyState, fmtMonth, fmtNum, PageHead, Spinner, Stat } from '../components';
import { downloadCsv } from '../export';
import { useLang } from '../i18n';
import { Pager } from './CompanyStockPage';
import { SortTh, useTableSort } from '../tableSort';

const PAGE_SIZE = 50;

function orderStatus(row: api.OrderRow): 'orders.statusClosed' | 'orders.statusReceived' | 'orders.statusOpen' {
  return row.isClosed ? 'orders.statusClosed' : row.openQty <= 0 ? 'orders.statusReceived' : 'orders.statusOpen';
}

export default function OrdersPage() {
  const { t } = useLang();
  const [query, setQuery] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [group, setGroup] = useState('');
  const [page, setPage] = useState(1);
  const sort = useTableSort<'month' | 'product' | 'project' | 'manufacturer' | 'qty' | 'document'>('month', 'desc');
  const changeSort = (key: typeof sort.key) => { sort.toggle(key); setPage(1); };
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<api.OrderPage | null>(null);
  const [lookups, setLookups] = useState<api.OrderLookups | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.orderLookups().then(setLookups).catch(() => setLookups({ manufacturers: [], groups: [] }));
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const result = await api.listOrders({ q: query, manufacturer, group, page, pageSize: PAGE_SIZE, sortBy: sort.key, sortDir: sort.direction });
        if (active) setData(result);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : t('common.error'));
      } finally {
        if (active) setLoading(false);
      }
    }, refresh ? 0 : 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, manufacturer, group, page, refresh, t, sort.key, sort.direction]);

  async function openDocument(row: api.OrderRow) {
    setOpeningId(row.id);
    setError('');
    try {
      const url = await api.orderDocumentUrl(row.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('orders.documentFailed'));
    } finally {
      setOpeningId(null);
    }
  }

  async function exportRows() {
    setExporting(true);
    setError('');
    try {
      const rows: api.OrderRow[] = [];
      let current = 1;
      let total = 0;
      do {
        const result = await api.listOrders({ q: query, manufacturer, group, page: current, pageSize: 200, sortBy: sort.key, sortDir: sort.direction });
        if (result.items.length === 0) break;
        rows.push(...result.items);
        total = result.total;
        current += 1;
      } while (rows.length < total);
      downloadCsv('orders.csv', [t('orders.month'), t('common.product'), t('orders.externalId'), t('common.project'), t('common.manufacturer'), t('orders.quantity'), t('orders.openQty'), t('orders.status'), t('orders.document')],
        rows.map((row) => [row.month.slice(0, 7), row.productName, row.externalId, row.projectName, row.manufacturerLabel, row.qty, row.openQty, t(orderStatus(row)), row.fileName]));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('common.error'));
    } finally {
      setExporting(false);
    }
  }

  return <>
    <PageHead icon={<ShoppingCart size={24} />} title={t('orders.title')} sub={t('orders.sub')}
      actions={<Button variant="outline" onClick={() => void exportRows()} disabled={exporting || !data?.total}>
        <Download data-icon="inline-start" />{exporting ? t('orders.exporting') : t('action.export')}
      </Button>} />

    <div className="stat-grid">
      <Stat tone="blue" icon={<ShoppingCart size={24} />} label={t('orders.allOrders')} value={fmtNum(data?.total)} />
      <Stat tone="violet" icon={<Package size={24} />} label={t('orders.totalOrdered')} value={fmtNum(data?.totalQty, 2)} />
    </div>

    <div className="toolbar">
      <div className="search"><Search size={18} /><Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={t('orders.search')} /></div>
      <select className="field" value={group} onChange={(event) => { setGroup(event.target.value); setPage(1); }} aria-label={t('common.project')}>
        <option value="">{t('common.project')}: {t('action.all')}</option>
        {lookups?.groups.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      <select className="field" value={manufacturer} onChange={(event) => { setManufacturer(event.target.value); setPage(1); }} aria-label={t('common.manufacturer')}>
        <option value="">{t('common.manufacturer')}: {t('action.all')}</option>
        {lookups?.manufacturers.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      <Button variant="ghost" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>
        <RefreshCw data-icon="inline-start" />{t('action.refresh')}
      </Button>
    </div>

    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {loading && !data ? <Spinner label={t('common.loading')} /> : data && <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="table-scroll"><table className="data">
        <thead><tr>
          <SortTh label={t('orders.month')} column="month" sort={{ ...sort, toggle: changeSort }} /><SortTh label={t('common.product')} column="product" sort={{ ...sort, toggle: changeSort }} /><SortTh label={t('common.project')} column="project" sort={{ ...sort, toggle: changeSort }} />
          <SortTh label={t('common.manufacturer')} column="manufacturer" sort={{ ...sort, toggle: changeSort }} /><SortTh label={t('orders.quantity')} column="qty" sort={{ ...sort, toggle: changeSort }} numeric /><th className="num">{t('orders.openQty')}</th><th>{t('orders.status')}</th><SortTh label={t('orders.document')} column="document" sort={{ ...sort, toggle: changeSort }} />
        </tr></thead>
        <tbody>{data.items.map((row) => <tr key={row.id}>
          <td>{fmtMonth(row.month)}</td>
          <td><Link className="cell-strong" to={`/products/${row.productId}`}>{row.productName}</Link>{row.externalId && <div className="cell-sub">{row.externalId}</div>}</td>
          <td>{row.projectName || '—'}</td><td>{row.manufacturerLabel || '—'}</td>
          <td className="num qty-strong">{fmtNum(row.qty, 2)}</td>
          <td className="num">{fmtNum(row.openQty, 2)}</td>
          <td>{t(orderStatus(row))}</td>
          <td>{row.fileName ? <Button variant="ghost" size="sm" onClick={() => void openDocument(row)} disabled={openingId === row.id} title={row.fileName}>
            <FileText data-icon="inline-start" />{row.fileName}
          </Button> : '—'}</td>
        </tr>)}</tbody>
      </table></div>
      {data.total === 0 && <EmptyState title={t('orders.empty')} hint={t('orders.emptyHint')} />}
      <div className="table-foot"><span>{fmtNum(data.total)} {t('common.results')}</span><Pager page={page} total={data.total} pageSize={PAGE_SIZE} onPage={setPage} /></div>
    </div>}
  </>;
}
