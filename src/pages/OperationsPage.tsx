import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardCheck, Download, RefreshCw, ShoppingCart, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import * as api from '../api';
import { downloadCsv } from '../export';
import { useLang } from '../i18n';
import { Chip, EmptyState, PageHead, Spinner, Stat, fmtDate, fmtNum } from '../components';

type Tab = 'alerts' | 'recommendations' | 'quality' | 'audit';

export default function OperationsPage() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('alerts');
  const [alerts, setAlerts] = useState<api.OperationalAlert[]>([]);
  const [recommendations, setRecommendations] = useState<api.Recommendation[]>([]);
  const [quality, setQuality] = useState<api.QualityIssue[]>([]);
  const [audit, setAudit] = useState<api.AuditEvent[]>([]);
  const [target, setTarget] = useState(6);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [a, r, q] = await Promise.all([api.listAlerts(), api.listRecommendations(target), api.listQualityIssues()]);
      setAlerts(a); setRecommendations(r); setQuality(q);
      try { setAudit(await api.listAuditEvents()); } catch { setAudit([]); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('common.error'));
    } finally { setLoading(false); }
  }, [t, target]);

  useEffect(() => { void load(); }, [load]);

  const critical = useMemo(() => alerts.filter((row) => row.severity === 'critical').length, [alerts]);
  const recommended = useMemo(() => recommendations.filter((row) => row.recommendedOrder > 0), [recommendations]);
  const productLink = (id: string | null) => id && navigate(`/products/${id}`);

  function exportCurrent() {
    if (tab === 'alerts') downloadCsv('marketing-alerts.csv', ['Type', 'Severity', 'Product', 'Detail', 'Quantity', 'Date'], alerts.map((r) => [r.kind, r.severity, r.productName, r.detail, r.quantity, r.date]));
    if (tab === 'recommendations') downloadCsv('purchase-recommendations.csv', ['Product', 'Project', 'Average sales', 'Current stock', 'Customs', 'Incoming', 'Open orders', 'Coverage', 'Target', 'Recommended order'], recommendations.map((r) => [r.productName, r.projectName, r.avgMonthlySales, r.currentStock, r.customsStock, r.incomingStock, r.openOrders, r.coverageMonths, r.targetMonths, r.recommendedOrder]));
    if (tab === 'quality') downloadCsv('data-quality.csv', ['Type', 'Severity', 'Product', 'Detail'], quality.map((r) => [r.kind, r.severity, r.productName, r.detail]));
  }

  return (
    <>
      <PageHead icon={<ShieldAlert size={24} />} title={t('ops.title')} sub={t('ops.sub')} actions={<div className="flex gap-2"><Button variant="outline" onClick={exportCurrent} disabled={tab === 'audit'}><Download data-icon="inline-start" />{t('action.export')}</Button><Button onClick={load}><RefreshCw data-icon="inline-start" />{t('action.refresh')}</Button></div>} />
      <div className="stat-grid">
        <Stat tone="red" icon={<AlertTriangle size={24} />} label={t('ops.critical')} value={fmtNum(critical)} />
        <Stat tone="amber" icon={<AlertTriangle size={24} />} label={t('ops.alerts')} value={fmtNum(alerts.length)} />
        <Stat tone="blue" icon={<ShoppingCart size={24} />} label={t('ops.toOrder')} value={fmtNum(recommended.length)} />
        <Stat tone="violet" icon={<ClipboardCheck size={24} />} label={t('ops.quality')} value={fmtNum(quality.length)} />
      </div>
      <div className="proj-tabs">
        {(['alerts', 'recommendations', 'quality', 'audit'] as Tab[]).map((value) => <button key={value} className={`proj-tab ${tab === value ? 'active' : ''}`} onClick={() => setTab(value)}>{t(`ops.tab.${value}`)}</button>)}
      </div>
      {tab === 'recommendations' && <div className="toolbar"><label className="field-label">{t('ops.targetMonths')}<select className="field" value={target} onChange={(e) => setTarget(Number(e.target.value))}>{[3, 6, 9, 12].map((n) => <option key={n} value={n}>{n}</option>)}</select></label></div>}
      {error && <div className="login-error">{error}</div>}
      {loading ? <Spinner label={t('common.loading')} /> : (
        <div className="table-wrap"><div className="table-scroll frozen">
          {tab === 'alerts' && (alerts.length ? <table className="data"><thead><tr><th>{t('ops.severity')}</th><th>{t('common.product')}</th><th>{t('ops.detail')}</th><th className="num">{t('common.qty')}</th><th>{t('customs.expiry')}</th></tr></thead><tbody>{alerts.map((row) => <tr key={row.id} className={row.productId ? 'click-row' : ''} onClick={() => productLink(row.productId)}><td><Chip tone={row.severity === 'critical' ? 'red' : row.severity === 'warning' ? 'amber' : 'blue'}>{row.severity}</Chip></td><td className="cell-strong">{row.productName}</td><td>{row.detail}</td><td className="num">{row.quantity == null ? '—' : fmtNum(row.quantity)}</td><td>{fmtDate(row.date)}</td></tr>)}</tbody></table> : <EmptyState title={t('common.none')} />)}
          {tab === 'recommendations' && (recommendations.length ? <table className="data"><thead><tr><th>{t('common.product')}</th><th>{t('common.project')}</th><th className="num">{t('company.avgSales')}</th><th className="num">{t('ops.available')}</th><th className="num">{t('company.forecast')}</th><th className="num">{t('ops.recommended')}</th></tr></thead><tbody>{recommendations.map((row) => <tr key={row.productId} className="click-row" onClick={() => productLink(row.productId)}><td className="cell-strong">{row.productName}</td><td>{row.projectName || '—'}</td><td className="num">{fmtNum(row.avgMonthlySales)}</td><td className="num">{fmtNum(row.currentStock + row.customsStock + row.incomingStock + row.openOrders)}</td><td className="num">{row.coverageMonths?.toFixed(1) ?? '—'}</td><td className="num"><span className="qty-strong">{fmtNum(row.recommendedOrder)}</span></td></tr>)}</tbody></table> : <EmptyState title={t('common.none')} />)}
          {tab === 'quality' && (quality.length ? <table className="data"><thead><tr><th>{t('ops.severity')}</th><th>{t('ops.type')}</th><th>{t('common.product')}</th><th>{t('ops.detail')}</th></tr></thead><tbody>{quality.map((row) => <tr key={row.id} className={row.productId ? 'click-row' : ''} onClick={() => productLink(row.productId)}><td><Chip tone={row.severity === 'critical' ? 'red' : 'amber'}>{row.severity}</Chip></td><td>{row.kind}</td><td className="cell-strong">{row.productName}</td><td>{row.detail}</td></tr>)}</tbody></table> : <EmptyState title={t('common.none')} />)}
          {tab === 'audit' && (audit.length ? <table className="data"><thead><tr><th>{t('ops.when')}</th><th>{t('ops.user')}</th><th>{t('ops.action')}</th><th>{t('ops.detail')}</th></tr></thead><tbody>{audit.map((row, index) => <tr key={`${row.at}-${index}`}><td>{new Date(row.at).toLocaleString()}</td><td>{row.actor}</td><td>{row.action}</td><td><code>{JSON.stringify(row.details)}</code></td></tr>)}</tbody></table> : <EmptyState title={t('common.none')} />)}
        </div></div>
      )}
    </>
  );
}
