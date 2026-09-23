import { useEffect, useMemo, useRef, useState } from 'react';
import { PackageCheck, Search, Layers, Boxes as BoxesIcon } from 'lucide-react';
import * as api from '../api';
import { useLang } from '../i18n';
import { PageHead, Spinner, EmptyState, Stat, Chip, type ChipTone, fmtNum, fmtDate } from '../components';

function regimeInfo(regime: string | null, transit: string, customs: string): { tone: ChipTone; label: string } {
  const r = (regime || '').toUpperCase();
  if (r.includes('INCOMING')) return { tone: 'amber', label: transit };
  return { tone: 'green', label: customs };
}

export default function ClearedProductsPage() {
  const { t } = useLang();
  const [q, setQ] = useState('');
  const [data, setData] = useState<api.ClearedList | null>(null);
  const [loading, setLoading] = useState(true);
  const debounce = useRef<number | undefined>(undefined);

  const load = useMemo(() => async () => {
    setLoading(true);
    try {
      setData(await api.listCleared({ q }));
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
      <PageHead icon={<PackageCheck size={24} />} title={t('cleared.title')} sub={t('cleared.sub')} />

      <div className="stat-grid">
        <Stat tone="blue" icon={<PackageCheck size={24} />} label={t('cleared.totalLines')} value={fmtNum(data?.total ?? 0)} />
        <Stat tone="green" icon={<Layers size={24} />} label={t('common.qty')} value={fmtNum(data?.totalQty ?? 0)} />
        <Stat tone="violet" icon={<Layers size={24} />} label={t('cleared.pallets')} value={fmtNum(data?.totalPallets ?? 0)} />
        <Stat tone="amber" icon={<BoxesIcon size={24} />} label={t('cleared.boxes')} value={fmtNum(data?.totalBoxes ?? 0)} />
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
                  <th>{t('cleared.invoice')}</th>
                  <th>{t('cleared.series')}</th>
                  <th>{t('customs.regime')}</th>
                  <th className="num">{t('common.qty')}</th>
                  <th className="num">{t('cleared.pallets')}</th>
                  <th className="num">{t('cleared.boxes')}</th>
                  <th>{t('cleared.comment')}</th>
                  <th>{t('cleared.date')}</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((r) => {
                  const reg = regimeInfo(r.regime, t('regime.transit'), t('regime.customs'));
                  return (
                    <tr key={r.id}>
                      <td><div className="cell-strong">{r.productName}</div></td>
                      <td>{r.invoiceName}</td>
                      <td>{r.seriesBatch ? <span className="series-chip">{r.seriesBatch}</span> : '—'}</td>
                      <td><Chip tone={reg.tone}>{reg.label}</Chip></td>
                      <td className="num"><span className="qty-strong">{fmtNum(r.qty)}</span></td>
                      <td className="num">{r.pallets != null ? fmtNum(r.pallets) : '—'}</td>
                      <td className="num">{r.boxes != null ? fmtNum(r.boxes) : '—'}</td>
                      <td style={{ maxWidth: 260, whiteSpace: 'normal', color: 'var(--text-soft)' }}>{r.comment || '—'}</td>
                      <td>{fmtDate(r.clearedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <span>{fmtNum(data?.total ?? 0)} {t('cleared.totalLines').toLowerCase()}</span>
          </div>
        </div>
      )}
    </>
  );
}
