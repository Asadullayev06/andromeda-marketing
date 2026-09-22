import { useEffect, useState } from 'react';
import { LayoutDashboard, Boxes, Warehouse, ShieldCheck, Send, AlertTriangle, CalendarClock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import * as api from '../api';
import { useLang } from '../i18n';
import { PageHead, Stat, Spinner, Stepper, GroupedBars, fmtNum, fmtMonth, Chip } from '../components';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function DashboardPage() {
  const { t } = useLang();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<api.DashboardSummary | null>(null);
  const [overview, setOverview] = useState<api.SalesOverview | null>(null);
  const [top, setTop] = useState<api.ProductSalesRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [sm, ov, tp] = await Promise.all([
          api.dashboardSummary(),
          api.salesOverview(12),
          api.topProducts(6, 8),
        ]);
        if (!alive) return;
        setSummary(sm);
        setOverview(ov);
        setTop(tp);
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : t('common.error'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [t]);

  if (loading) return <Spinner label={t('common.loading')} />;
  if (error) return <div className="login-error">{error} <Button size="sm" onClick={() => location.reload()}>{t('action.refresh')}</Button></div>;

  const steps = [
    { label: t('customs.title'), state: 'done' as const },
    { label: t('nav.company'), state: 'done' as const },
    { label: t('nav.warehouses'), state: 'current' as const },
    { label: t('sales.dispatched'), state: 'pending' as const },
    { label: t('sales.sold'), state: 'pending' as const },
  ];

  return (
    <>
      <PageHead icon={<LayoutDashboard size={24} />} title={t('dash.title')} sub={t('dash.sub')} />

      <div className="stat-grid">
        <Stat tone="blue" icon={<Boxes size={26} />} label={t('dash.companyProducts')} value={fmtNum(summary?.companyProducts ?? 0)} />
        <Stat tone="green" icon={<Warehouse size={26} />} label={t('dash.warehouses')} value={fmtNum(summary?.warehouses ?? 0)} />
        <Stat tone="amber" icon={<ShieldCheck size={26} />} label={t('dash.customsProducts')} value={fmtNum(summary?.customsPositions ?? 0)} />
        <Stat tone="violet" icon={<Send size={24} />} label={t('dash.dispatched')} value={fmtNum(overview?.totalDispatched ?? 0)} />
        <Stat tone="red" icon={<AlertTriangle size={24} />} label={t('ops.lowStock')} value={fmtNum(summary?.lowStockProducts ?? 0)} />
        <Stat tone="amber" icon={<CalendarClock size={24} />} label={t('ops.expiring')} value={fmtNum(summary?.expiringBatches ?? 0)} />
      </div>

      <div className="snapshot-banner">
        <span>{t('ops.snapshot')}: <b>{summary?.expirySnapshot.source}</b> · {summary?.expirySnapshot.importedAt}</span>
        <Button size="sm" variant="outline" render={<Link to="/operations" />}>{t('ops.open')}</Button>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">{t('dash.pipeline')}</div>
        <Stepper steps={steps} />
      </div>

      <div className="grid-2">
        <Card className="dashboard-card chart-card">
          <CardHeader>
            <CardTitle>{t('dash.salesTrend')}</CardTitle>
          </CardHeader>
          <CardContent className="chart-card-content">
            {overview && overview.months.length > 0 ? (
              <GroupedBars
                data={overview.months.map((m) => ({ label: fmtMonth(m.month), a: m.dispatched, b: m.sold }))}
                labels={[t('sales.dispatched'), t('sales.sold')]}
                colorA="#2f6bff"
                colorB="#22c55e"
              />
            ) : (
              <div className="empty"><h3>{t('common.none')}</h3></div>
            )}
          </CardContent>
        </Card>

        <Card className="dashboard-card top-products-card">
          <CardHeader>
            <CardTitle>{t('dash.topProducts')}</CardTitle>
          </CardHeader>
          <CardContent>
            {top.length === 0 ? (
              <div className="empty"><h3>{t('common.none')}</h3></div>
            ) : (
              <ol className="top-products-list">
                {top.map((p) => (
                  <li key={p.productId} className="top-product-row">
                    <div className="top-product-copy">
                      <div className="top-product-name">{p.name}</div>
                      <div className="top-product-manufacturer">{p.manufacturerLabel || '—'}</div>
                    </div>
                    <Chip tone="blue">{fmtNum(p.dispatched)}</Chip>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
