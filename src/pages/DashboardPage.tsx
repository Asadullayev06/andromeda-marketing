import { useEffect, useState } from 'react';
import { LayoutDashboard, Boxes, Warehouse, ShieldCheck, Send } from 'lucide-react';
import * as api from '../api';
import { useLang } from '../i18n';
import { PageHead, Stat, Spinner, Stepper, GroupedBars, fmtNum, fmtMonth, Chip } from '../components';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function DashboardPage() {
  const { t } = useLang();
  const [loading, setLoading] = useState(true);
  const [companyInStock, setCompanyInStock] = useState(0);
  const [warehouses, setWarehouses] = useState(0);
  const [customsPositions, setCustomsPositions] = useState(0);
  const [overview, setOverview] = useState<api.SalesOverview | null>(null);
  const [top, setTop] = useState<api.ProductSalesRow[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [cs, whs, customs, ov, tp] = await Promise.all([
          api.listCompanyStock({ page: 1, pageSize: 1 }),
          api.listWarehouses(false),
          api.listCustoms({}),
          api.salesOverview(12),
          api.topProducts(6, 8),
        ]);
        if (!alive) return;
        setCompanyInStock(cs.productsInStock);
        setWarehouses(whs.length);
        setCustomsPositions(customs.totalProducts);
        setOverview(ov);
        setTop(tp);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <Spinner label={t('common.loading')} />;

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
        <Stat tone="blue" icon={<Boxes size={26} />} label={t('dash.companyProducts')} value={fmtNum(companyInStock)} />
        <Stat tone="green" icon={<Warehouse size={26} />} label={t('dash.warehouses')} value={fmtNum(warehouses)} />
        <Stat tone="amber" icon={<ShieldCheck size={26} />} label={t('dash.customsProducts')} value={fmtNum(customsPositions)} />
        <Stat tone="violet" icon={<Send size={24} />} label={t('dash.dispatched')} value={fmtNum(overview?.totalDispatched ?? 0)} />
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
