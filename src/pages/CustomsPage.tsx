import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, Search, FileText, FileCheck2 } from 'lucide-react';
import * as api from '../api';
import { useLang } from '../i18n';
import { PageHead, Spinner, EmptyState, Stat, Chip, type ChipTone, fmtNum, fmtDate } from '../components';

function regimeTone(regime: string): ChipTone {
  const r = regime.toUpperCase();
  if (r.includes('INCOMING')) return 'amber';
  if (r.includes('IM-74') || r.includes('74')) return 'green';
  if (r.includes('TR-80') || r.includes('80')) return 'blue';
  return 'slate';
}

function certTone(status: string): ChipTone {
  if (status === 'available') return 'green';
  if (status === 'applied') return 'blue';
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

  function certLabel(status: string): string {
    if (status === 'available') return t('cert.available');
    if (status === 'applied') return t('cert.applied');
    return t('cert.none');
  }

  async function openCertificate(invoiceId: string) {
    try {
      const url = await api.customsCertificateUrl(invoiceId);
      window.open(url, '_blank', 'noopener');
    } catch {
      /* no certificate / storage unavailable */
    }
  }

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
          <div className="table-scroll frozen">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('common.product')}</th>
                  <th>{t('customs.expiry')}</th>
                  <th className="num">{t('common.qty')}</th>
                  <th>{t('customs.regime')}</th>
                  <th>{t('customs.certificate')}</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((p) => {
                  const isOpen = !!open[p.id];
                  return (
                    <Fragment key={p.id}>
                      <tr>
                        <td><div className="cell-strong">{p.productName}</div></td>
                        <td>{p.productExpiry ? fmtDate(p.productExpiry) : '—'}</td>
                        <td className="num">
                          {p.series.length > 0 ? (
                            <button className="stock-link" onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))} title="Series">
                              {fmtNum(p.qty)}
                            </button>
                          ) : (
                            <span className="qty-strong">{fmtNum(p.qty)}</span>
                          )}
                        </td>
                        <td><Chip tone={regimeTone(p.regime)}>{p.regime}</Chip></td>
                        <td>
                          {p.hasCertificate ? (
                            <button className="cert-btn" onClick={() => openCertificate(p.invoiceId)}>
                              <FileCheck2 size={15} /> {certLabel(p.certificateStatus)}
                            </button>
                          ) : (
                            <Chip tone={certTone(p.certificateStatus)}>{certLabel(p.certificateStatus)}</Chip>
                          )}
                        </td>
                      </tr>
                      {isOpen && p.series.length > 0 && (
                        <tr className="subtable">
                          <td colSpan={5}>
                            <div className="subtable-inner">
                              <div className="series-chips">
                                {p.series.map((s) => (
                                  <span key={s.id} className="series-chip">{s.batch} · <b>{fmtNum(s.qty)}</b></span>
                                ))}
                              </div>
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
            <span>{fmtNum(data?.totalProducts ?? 0)} {t('customs.positions')}</span>
          </div>
        </div>
      )}
    </>
  );
}
