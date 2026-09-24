import { useEffect, useState } from 'react';
import { ArrowLeft, Boxes, CalendarDays, FileBadge, ShieldCheck, TrendingUp, Warehouse } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import * as api from '../api';
import { useLang } from '../i18n';
import { Chip, EmptyState, GroupedBars, PageHead, Spinner, Stat, fmtDate, fmtMonth, fmtNum } from '../components';
import { SortTh, sortRows, useTableSort } from '../tableSort';

export default function ProductDetailPage() {
  const { t } = useLang();
  const { productId = '' } = useParams();
  const [data, setData] = useState<api.ProductDossier | null>(null);
  const [error, setError] = useState('');
  const warehouseSort = useTableSort<'name' | 'quantity'>('name');
  const expirySort = useTableSort<'expiry_date' | 'batch_number' | 'quantity'>('expiry_date');
  const customsSort = useTableSort<'invoice' | 'regime' | 'expiry_date' | 'quantity'>('invoice');
  useEffect(() => { api.productDossier(productId).then(setData).catch((e) => setError(e instanceof Error ? e.message : t('common.error'))); }, [productId, t]);
  if (error) return <div className="login-error">{error}</div>;
  if (!data) return <Spinner label={t('common.loading')} />;
  const whTotal = data.warehouses.reduce((sum, row) => sum + row.quantity, 0);
  const expiryTotal = data.expiries.reduce((sum, row) => sum + row.quantity, 0);
  const customsTotal = data.customs.reduce((sum, row) => sum + row.quantity, 0);
  return <>
    <PageHead icon={<Boxes size={24} />} title={data.product.name} sub={[data.product.manufacturer_label, data.product.project_name, data.product.external_id].filter(Boolean).join(' · ')} actions={<Button variant="outline" render={<Link to="/company-stock" />}><ArrowLeft data-icon="inline-start" />{t('action.back')}</Button>} />
    <div className="stat-grid"><Stat tone="blue" icon={<Boxes size={24} />} label={t('modal.total')} value={fmtNum(data.companyStock)} /><Stat tone="green" icon={<Warehouse size={24} />} label={t('nav.warehouses')} value={fmtNum(whTotal)} /><Stat tone="amber" icon={<ShieldCheck size={24} />} label={t('company.customs')} value={fmtNum(customsTotal)} /><Stat tone="violet" icon={<CalendarDays size={24} />} label={t('company.expiry.title')} value={fmtNum(expiryTotal)} /></div>
    <div className="grid-2 dossier-grid">
      <section className="card"><div className="card-title"><Warehouse size={18} /> {t('nav.warehouses')}</div>{data.warehouses.length ? <table className="data compact"><thead><tr><SortTh label={t('modal.warehouse')} column="name" sort={warehouseSort} /><SortTh label={t('common.qty')} column="quantity" sort={warehouseSort} numeric /></tr></thead><tbody>{sortRows(data.warehouses, warehouseSort.key, warehouseSort.direction, (row, key) => row[key as typeof warehouseSort.key]).map((row) => <tr key={`${row.name}-${row.code}`}><td>{row.name}<div className="cell-sub">{row.code || '—'}</div></td><td className="num qty-strong">{fmtNum(row.quantity)}</td></tr>)}</tbody></table> : <EmptyState title={t('common.none')} />}</section>
      <section className="card"><div className="card-title"><CalendarDays size={18} /> {t('company.expiry.title')}</div>{data.expiries.length ? <table className="data compact"><thead><tr><SortTh label={t('customs.expiry')} column="expiry_date" sort={expirySort} /><SortTh label={t('customs.batches')} column="batch_number" sort={expirySort} /><SortTh label={t('common.qty')} column="quantity" sort={expirySort} numeric /></tr></thead><tbody>{sortRows(data.expiries, expirySort.key, expirySort.direction, (row, key) => row[key as typeof expirySort.key]).map((row, index) => <tr key={`${row.batch_number}-${index}`}><td>{fmtDate(row.expiry_date)}</td><td>{row.batch_number || '—'}</td><td className="num">{fmtNum(row.quantity)}</td></tr>)}</tbody></table> : <EmptyState title={t('common.none')} />}</section>
      <section className="card"><div className="card-title"><TrendingUp size={18} /> {t('dash.salesTrend')}</div>{data.sales.length ? <GroupedBars height={280} data={data.sales.map((row) => ({ label: fmtMonth(row.month), a: row.dispatched, b: row.sold }))} labels={[t('sales.dispatched'), t('sales.sold')]} colorA="#2f6bff" colorB="#22c55e" /> : <EmptyState title={t('common.none')} />}</section>
      <section className="card"><div className="card-title"><FileBadge size={18} /> {t('nav.certificates')}</div>{data.certificates.length ? <div className="detail-list">{data.certificates.map((cert) => <div className="detail-list-row" key={cert.id}><div><b>{cert.number}</b><div className="cell-sub">{cert.trade_name}</div></div><Chip tone={cert.valid_until && new Date(cert.valid_until) < new Date() ? 'red' : 'green'}>{fmtDate(cert.valid_until)}</Chip></div>)}</div> : <EmptyState title={t('common.none')} />}</section>
      <section className="card dossier-wide"><div className="card-title"><ShieldCheck size={18} /> {t('customs.title')}</div>{data.customs.length ? <table className="data compact"><thead><tr><SortTh label={t('customs.invoice')} column="invoice" sort={customsSort} /><SortTh label={t('customs.regime')} column="regime" sort={customsSort} /><SortTh label={t('customs.expiry')} column="expiry_date" sort={customsSort} /><SortTh label={t('common.qty')} column="quantity" sort={customsSort} numeric /></tr></thead><tbody>{sortRows(data.customs, customsSort.key, customsSort.direction, (row, key) => row[key as typeof customsSort.key]).map((row) => <tr key={row.id}><td>{row.invoice}</td><td>{row.regime}</td><td>{fmtDate(row.expiry_date)}</td><td className="num">{fmtNum(row.quantity)}</td></tr>)}</tbody></table> : <EmptyState title={t('common.none')} />}</section>
    </div>
  </>;
}
