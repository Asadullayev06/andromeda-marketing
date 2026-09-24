import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardCheck, Download, RefreshCw, ShoppingCart, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import * as api from '../api';
import { downloadCsv } from '../export';
import { useLang } from '../i18n';
import { Chip, EmptyState, PageHead, Spinner, Stat, fmtDate, fmtNum } from '../components';
import { SortTh, sortRows, useTableSort } from '../tableSort';

type Tab = 'alerts' | 'recommendations' | 'quality' | 'audit';

export default function OperationsPage() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('alerts');
  const alertSort = useTableSort<'severity' | 'productName' | 'detail' | 'quantity' | 'date'>('severity');
  const recommendationSort = useTableSort<'productName' | 'projectName' | 'avgMonthlySales' | 'available' | 'coverageMonths' | 'recommendedOrder'>('recommendedOrder', 'desc');
  const qualitySort = useTableSort<'severity' | 'kind' | 'productName' | 'detail'>('severity');
  const auditSort = useTableSort<'at' | 'actor' | 'action' | 'details'>('at', 'desc');
  const [alerts, setAlerts] = useState<api.OperationalAlert[]>([]);
  const [recommendations, setRecommendations] = useState<api.Recommendation[]>([]);
  const [quality, setQuality] = useState<api.QualityIssue[]>([]);
  const [audit, setAudit] = useState<api.AuditEvent[]>([]);
  const [target, setTarget] = useState(6);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [a, r, q] = await Promise.all([api.listAlerts(), api.listRecommendations(target), api.listQualityIssues()]);
      setAlerts(a); setRecommendations(r); setQuality(q);
      try { setAudit(await api.listAuditEvents()); } catch { setAudit([]); }
      setHasLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('common.error'));
    } finally { setLoading(false); }
  }, [t, target]);

  useEffect(() => { void load(); }, [load]);

  const critical = useMemo(() => alerts.filter((row) => row.severity === 'critical').length, [alerts]);
  const recommended = useMemo(() => recommendations.filter((row) => row.recommendedOrder > 0), [recommendations]);
  const productLink = (id: string | null) => id && navigate(`/products/${id}`);
  const sortedAlerts = sortRows(alerts, alertSort.key, alertSort.direction, (row, key) => row[key as typeof alertSort.key]);
  const sortedRecommendations = sortRows(recommendations, recommendationSort.key, recommendationSort.direction, (row, key) =>
    key === 'available' ? row.currentStock + row.customsStock + row.incomingStock + row.openOrders : row[key as Exclude<typeof recommendationSort.key, 'available'>]);
  const sortedQuality = sortRows(quality, qualitySort.key, qualitySort.direction, (row, key) => row[key as typeof qualitySort.key]);
  const sortedAudit = sortRows(audit, auditSort.key, auditSort.direction, (row, key) => key === 'details' ? JSON.stringify(row.details) : row[key as Exclude<typeof auditSort.key, 'details'>]);

  function exportCurrent() {
    if (tab === 'alerts') downloadCsv('marketing-alerts.csv', ['Type', 'Severity', 'Product', 'Detail', 'Quantity', 'Date'], alerts.map((r) => [r.kind, r.severity, r.productName, r.detail, r.quantity, r.date]));
    if (tab === 'recommendations') downloadCsv('purchase-recommendations.csv', ['Product', 'Project', 'Average sales', 'Current stock', 'Customs', 'Incoming', 'Open orders', 'Coverage', 'Target', 'Recommended order'], recommendations.map((r) => [r.productName, r.projectName, r.avgMonthlySales, r.currentStock, r.customsStock, r.incomingStock, r.openOrders, r.coverageMonths, r.targetMonths, r.recommendedOrder]));
    if (tab === 'quality') downloadCsv('data-quality.csv', ['Type', 'Severity', 'Product', 'Detail'], quality.map((r) => [r.kind, r.severity, r.productName, r.detail]));
  }

  return (
    <>
      <PageHead icon={<ShieldAlert size={24} />} title={t('ops.title')} sub={t('ops.sub')} actions={<div className="flex gap-2"><Button variant="outline" onClick={exportCurrent} disabled={tab === 'audit'}><Download data-icon="inline-start" />{t('action.export')}</Button><Button onClick={load}><RefreshCw data-icon="inline-start" />{t('action.refresh')}</Button></div>} />
      <div className="stat-grid">
        <Stat tone="red" icon={<AlertTriangle size={24} />} label={t('ops.critical')} value={hasLoaded ? fmtNum(critical) : '—'} />
        <Stat tone="amber" icon={<AlertTriangle size={24} />} label={t('ops.alerts')} value={hasLoaded ? fmtNum(alerts.length) : '—'} />
        <Stat tone="blue" icon={<ShoppingCart size={24} />} label={t('ops.toOrder')} value={hasLoaded ? fmtNum(recommended.length) : '—'} />
        <Stat tone="violet" icon={<ClipboardCheck size={24} />} label={t('ops.quality')} value={hasLoaded ? fmtNum(quality.length) : '—'} />
      </div>
      <div className="proj-tabs">
        {(['alerts', 'recommendations', 'quality', 'audit'] as Tab[]).map((value) => <button key={value} className={`proj-tab ${tab === value ? 'active' : ''}`} onClick={() => setTab(value)}>{t(`ops.tab.${value}`)}</button>)}
      </div>
      {tab === 'recommendations' && <div className="toolbar"><label className="field-label">{t('ops.targetMonths')}<select className="field" value={target} onChange={(e) => setTarget(Number(e.target.value))}>{[3, 6, 9, 12].map((n) => <option key={n} value={n}>{n}</option>)}</select></label></div>}
      {error && <div className="login-error">{error}</div>}
      {loading ? <Spinner label={t('common.loading')} /> : !hasLoaded ? null : (
        <div className="table-wrap"><div className="table-scroll frozen">
          {tab === 'alerts' && (alerts.length ? <table className="data"><thead><tr><SortTh label={t('ops.severity')} column="severity" sort={alertSort} /><SortTh label={t('common.product')} column="productName" sort={alertSort} /><SortTh label={t('ops.detail')} column="detail" sort={alertSort} /><SortTh label={t('common.qty')} column="quantity" sort={alertSort} numeric /><SortTh label={t('customs.expiry')} column="date" sort={alertSort} /></tr></thead><tbody>{sortedAlerts.map((row) => <tr key={row.id} className={row.productId ? 'click-row' : ''} onClick={() => productLink(row.productId)}><td><Chip tone={row.severity === 'critical' ? 'red' : row.severity === 'warning' ? 'amber' : 'blue'}>{row.severity}</Chip></td><td className="cell-strong">{row.productName}</td><td>{row.detail}</td><td className="num">{row.quantity == null ? '—' : fmtNum(row.quantity)}</td><td>{fmtDate(row.date)}</td></tr>)}</tbody></table> : <EmptyState title={t('common.none')} />)}
          {tab === 'recommendations' && (recommendations.length ? <table className="data"><thead><tr><SortTh label={t('common.product')} column="productName" sort={recommendationSort} /><SortTh label={t('common.project')} column="projectName" sort={recommendationSort} /><SortTh label={t('company.avgSales')} column="avgMonthlySales" sort={recommendationSort} numeric /><SortTh label={t('ops.available')} column="available" sort={recommendationSort} numeric /><SortTh label={t('company.forecast')} column="coverageMonths" sort={recommendationSort} numeric /><SortTh label={t('ops.recommended')} column="recommendedOrder" sort={recommendationSort} numeric /></tr></thead><tbody>{sortedRecommendations.map((row) => <tr key={row.productId} className="click-row" onClick={() => productLink(row.productId)}><td className="cell-strong">{row.productName}</td><td>{row.projectName || '—'}</td><td className="num">{fmtNum(row.avgMonthlySales)}</td><td className="num">{fmtNum(row.currentStock + row.customsStock + row.incomingStock + row.openOrders)}</td><td className="num">{row.coverageMonths?.toFixed(1) ?? '—'}</td><td className="num"><span className="qty-strong">{fmtNum(row.recommendedOrder)}</span></td></tr>)}</tbody></table> : <EmptyState title={t('common.none')} />)}
          {tab === 'quality' && (quality.length ? <table className="data"><thead><tr><SortTh label={t('ops.severity')} column="severity" sort={qualitySort} /><SortTh label={t('ops.type')} column="kind" sort={qualitySort} /><SortTh label={t('common.product')} column="productName" sort={qualitySort} /><SortTh label={t('ops.detail')} column="detail" sort={qualitySort} /></tr></thead><tbody>{sortedQuality.map((row) => <tr key={row.id} className={row.productId ? 'click-row' : ''} onClick={() => productLink(row.productId)}><td><Chip tone={row.severity === 'critical' ? 'red' : 'amber'}>{row.severity}</Chip></td><td>{row.kind}</td><td className="cell-strong">{row.productName}</td><td>{row.detail}</td></tr>)}</tbody></table> : <EmptyState title={t('common.none')} />)}
          {tab === 'audit' && (audit.length ? <table className="data"><thead><tr><SortTh label={t('ops.when')} column="at" sort={auditSort} /><SortTh label={t('ops.user')} column="actor" sort={auditSort} /><SortTh label={t('ops.action')} column="action" sort={auditSort} /><SortTh label={t('ops.detail')} column="details" sort={auditSort} /></tr></thead><tbody>{sortedAudit.map((row, index) => <tr key={`${row.at}-${index}`}><td>{new Date(row.at).toLocaleString()}</td><td>{row.actor}</td><td>{row.action}</td><td><code>{JSON.stringify(row.details)}</code></td></tr>)}</tbody></table> : <EmptyState title={t('common.none')} />)}
        </div></div>
      )}
    </>
  );
}
