import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, Search, ChevronRight, ChevronDown, FileText } from 'lucide-react';
import * as api from '../api';
import { useLang } from '../i18n';
import { PageHead, Spinner, EmptyState, Stat, Chip, fmtNum, fmtDate } from '../components';

function regimeTone(regime: string): 'green' | 'amber' | 'blue' | 'slate' {
  const r = regime.toUpperCase();
  if (r.includes('INCOMING')) return 'amber';
  if (r.includes('IM') || r.includes('40')) return 'green';
  if (r.includes('TR') || r.includes('80')) return 'blue';
  return 'slate';
}

export default function CustomsPage() {
  const { t } = useLang();
  const [q, setQ] = useState('');
  const [data, setData] = useState<api.CustomsList | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const debounce = useRef<number | undefined>(undefined);

  const load = useMemo(() => async () => {
    setLoading(true);
    try {
      setData(await api.listCustoms({ q }));
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(load, 250);
    return () => window.clearTimeout(debounce.current);
  }, [load]);

  return (
    <>
      <PageHead icon={<ShieldCheck size={24} />} title={t('customs.title')} sub={t('customs.sub')} />

      <div className="stat-grid">
        <Stat tone="blue" icon={<FileText size={24} />} label={t('customs.invoices')} value={fmtNum(data?.totalInvoices ?? 0)} />
        <Stat tone="green" icon={<ShieldCheck size={24} />} label={t('customs.positions')} value={fmtNum(data?.totalProducts ?? 0)} />
        <Stat tone="amber" icon={<ShieldCheck size={24} />} label={t('common.qty')} value={fmtNum(data?.totalQty ?? 0)} />
      </div>

      <div className="toolbar">
        <div className="search">
          <Search size={18} />
          <input placeholder={t('action.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
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
                  <th style={{ width: 40 }}></th>
                  <th>{t('customs.invoices')}</th>
                  <th>{t('customs.supplier')}</th>
                  <th>{t('customs.expiry')}</th>
                  <th className="num">{t('customs.positions')}</th>
                  <th className="num">{t('common.qty')}</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((inv) => {
                  const isOpen = !!open[inv.id];
                  return (
                    <Fragment key={inv.id}>
                      <tr className="expandable" onClick={() => setOpen((o) => ({ ...o, [inv.id]: !o[inv.id] }))}>
                        <td>{isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</td>
                        <td><div className="cell-strong">{inv.name}</div></td>
                        <td>{inv.supplierLabel || '—'}</td>
                        <td>{inv.regimeExpiry ? <Chip tone="amber">{fmtDate(inv.regimeExpiry)}</Chip> : '—'}</td>
                        <td className="num">{fmtNum(inv.productCount)}</td>
                        <td className="num"><span className="qty-strong" style={{ color: 'var(--primary-strong)' }}>{fmtNum(inv.totalQty)}</span></td>
                      </tr>
                      {isOpen && (
                        <tr className="subtable">
                          <td colSpan={6}>
                            <div className="subtable-inner">
                              <table className="data" style={{ boxShadow: 'none' }}>
                                <thead>
                                  <tr>
                                    <th>{t('common.product')}</th>
                                    <th>{t('customs.regime')}</th>
                                    <th>{t('common.category')}</th>
                                    <th className="num">{t('common.qty')}</th>
                                    <th>{t('customs.batches')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {inv.products.map((p) => (
                                    <tr key={p.id}>
                                      <td>
                                        <div className="cell-strong">{p.productName}</div>
                                        {p.productExpiry && <div className="cell-sub">exp. {fmtDate(p.productExpiry)}</div>}
                                      </td>
                                      <td><Chip tone={regimeTone(p.regime)}>{p.regime}</Chip></td>
                                      <td>{p.category || '—'}</td>
                                      <td className="num"><span className="qty-strong">{fmtNum(p.qty)}</span></td>
                                      <td>
                                        {p.series.length === 0 ? '—' : (
                                          <div className="series-chips">
                                            {p.series.map((s) => (
                                              <span key={s.id} className="series-chip">{s.batch} · <b>{fmtNum(s.qty)}</b></span>
                                            ))}
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <span>{fmtNum(data?.totalInvoices ?? 0)} {t('customs.invoices')}</span>
          </div>
        </div>
      )}
    </>
  );
}
