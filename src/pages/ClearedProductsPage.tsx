import { useEffect, useMemo, useRef, useState } from 'react';
import { PackageCheck, Search, Layers, Boxes as BoxesIcon, BellRing, Check } from 'lucide-react';
import * as api from '../api';
import { useLang } from '../i18n';
import { PageHead, Spinner, EmptyState, Stat, Chip, type ChipTone, fmtNum, fmtDate } from '../components';
import { SortTh, sortRows, useTableSort } from '../tableSort';

function regimeInfo(regime: string | null, transit: string, customs: string): { tone: ChipTone; label: string } {
  const r = (regime || '').toUpperCase();
  if (r.includes('INCOMING')) return { tone: 'amber', label: transit };
  return { tone: 'green', label: customs };
}

// Watermark of the newest clearance the user has already seen. Clearances are
// written by the main ANDROMEDA platform, so the sales side only reads them;
// this lets us flag rows cleared since the last visit. Stored per-browser.
const SEEN_KEY = 'sales.cleared.seenAt';
const readSeen = (): string | null => { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } };
const writeSeen = (v: string) => { try { localStorage.setItem(SEEN_KEY, v); } catch { /* ignore */ } };
// ISO 8601 strings compare chronologically, so a plain string max is safe here.
const newestOf = (items: api.ClearedRow[]): string | null =>
  items.reduce<string | null>((m, i) => (i.clearedAt && (!m || i.clearedAt > m) ? i.clearedAt : m), null);

export default function ClearedProductsPage() {
  const { t } = useLang();
  const [q, setQ] = useState('');
  const [data, setData] = useState<api.ClearedList | null>(null);
  const [loading, setLoading] = useState(true);
  const [seenAt, setSeenAt] = useState<string | null>(() => readSeen());
  const sort = useTableSort<keyof api.ClearedRow>('productName');
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

  // Poll for freshly cleared goods while the tab is visible, so the banner and
  // row highlights appear without a manual refresh.
  useEffect(() => {
    const id = window.setInterval(() => { if (!document.hidden) load(); }, 60000);
    return () => window.clearInterval(id);
  }, [load]);

  // First ever visit: baseline the watermark silently so we don't flag the
  // entire existing backlog as "new".
  useEffect(() => {
    if (!data || seenAt != null) return;
    const newest = newestOf(data.items);
    if (newest) { setSeenAt(newest); writeSeen(newest); }
  }, [data, seenAt]);

  const newIds = useMemo(() => {
    if (!data || !seenAt) return new Set<string>();
    return new Set(data.items.filter((i) => i.clearedAt > seenAt).map((i) => i.id));
  }, [data, seenAt]);
  const newCount = newIds.size;

  const markSeen = () => {
    if (!data) return;
    const newest = newestOf(data.items);
    const next = newest && (!seenAt || newest > seenAt) ? newest : seenAt;
    if (next) { setSeenAt(next); writeSeen(next); }
  };

  return (
    <>
      <PageHead icon={<PackageCheck size={24} />} title={t('cleared.title')} sub={t('cleared.sub')} />

      {newCount > 0 && (
        <div className="new-banner" role="status">
          <BellRing size={18} />
          <span>{t('cleared.newBanner').replace('{count}', String(newCount))}</span>
          <button type="button" className="new-banner-btn" onClick={markSeen}>
            <Check size={15} /> {t('cleared.markSeen')}
          </button>
        </div>
      )}

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
                  <SortTh label={t('common.product')} column="productName" sort={sort} />
                  <SortTh label={t('cleared.invoice')} column="invoiceName" sort={sort} />
                  <SortTh label={t('cleared.series')} column="seriesBatch" sort={sort} />
                  <SortTh label={t('customs.regime')} column="regime" sort={sort} />
                  <SortTh label={t('common.qty')} column="qty" sort={sort} numeric />
                  <SortTh label={t('cleared.pallets')} column="pallets" sort={sort} numeric />
                  <SortTh label={t('cleared.boxes')} column="boxes" sort={sort} numeric />
                  <SortTh label={t('cleared.comment')} column="comment" sort={sort} />
                  <SortTh label={t('cleared.date')} column="clearedAt" sort={sort} />
                </tr>
              </thead>
              <tbody>
                {data && sortRows(data.items, sort.key, sort.direction, (row, key) => row[key as keyof api.ClearedRow] as string | number | null).map((r) => {
                  const reg = regimeInfo(r.regime, t('regime.transit'), t('regime.customs'));
                  const isNew = newIds.has(r.id);
                  return (
                    <tr key={r.id} className={isNew ? 'row-new' : ''}>
                      <td>
                        <div className="cell-strong">
                          {isNew && <Chip tone="blue">{t('cleared.new')}</Chip>} {r.productName}
                        </div>
                      </td>
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
