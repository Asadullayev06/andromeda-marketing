import { useEffect, useState } from 'react';
import { TrendingUp, Send, ShoppingCart } from 'lucide-react';
import * as api from '../api';
import { useLang } from '../i18n';
import { PageHead, Spinner, EmptyState, Stat, GroupedBars, fmtNum, fmtMonth } from '../components';

export default function SalesPage() {
  const { t } = useLang();
  const [overview, setOverview] = useState<api.SalesOverview | null>(null);
  const [top, setTop] = useState<api.ProductSalesRow[] | null>(null);

  useEffect(() => {
    api.salesOverview(12).then(setOverview).catch(() => setOverview({ months: [], totalDispatched: 0, totalSold: 0 }));
    api.topProducts(6, 25).then(setTop).catch(() => setTop([]));
  }, []);

  if (!overview || !top) return <Spinner label={t('common.loading')} />;

  return (
    <>
      <PageHead icon={<TrendingUp size={24} />} title={t('sales.title')} sub={t('sales.sub')} />

      <div className="stat-grid">
        <Stat tone="blue" icon={<Send size={24} />} label={t('sales.dispatched')} value={fmtNum(overview.totalDispatched)} hint="12m" />
        <Stat tone="green" icon={<ShoppingCart size={24} />} label={t('sales.sold')} value={fmtNum(overview.totalSold)} hint="12m" />
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">{t('dash.salesTrend')}</div>
        {overview.months.length > 0 ? (
          <GroupedBars
            data={overview.months.map((m) => ({ label: fmtMonth(m.month), a: m.dispatched, b: m.sold }))}
            labels={[t('sales.dispatched'), t('sales.sold')]}
            colorA="#2f6bff"
            colorB="#22c55e"
            height={300}
          />
        ) : (
          <EmptyState title={t('common.none')} />
        )}
      </div>

      <div className="card">
        <div className="card-title">{t('dash.topProducts')}</div>
        {top.length === 0 ? (
          <EmptyState title={t('common.none')} />
        ) : (
          <div className="table-scroll">
            <table className="data" style={{ boxShadow: 'none' }}>
              <thead>
                <tr>
                  <th>{t('common.product')}</th>
                  <th>{t('common.manufacturer')}</th>
                  <th className="num">{t('sales.dispatched')}</th>
                  <th className="num">{t('sales.sold')}</th>
                </tr>
              </thead>
              <tbody>
                {top.map((p) => (
                  <tr key={p.productId}>
                    <td><div className="cell-strong">{p.name}</div></td>
                    <td>{p.manufacturerLabel || '—'}</td>
                    <td className="num"><span className="qty-strong" style={{ color: 'var(--primary-strong)' }}>{fmtNum(p.dispatched)}</span></td>
                    <td className="num"><span className="qty-strong" style={{ color: 'var(--green)' }}>{fmtNum(p.sold)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
