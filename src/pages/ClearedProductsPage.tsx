import { useEffect, useMemo, useRef, useState } from 'react';
import { PackageCheck, Search, Layers, Boxes as BoxesIcon, BellRing, Check, Trash2 } from 'lucide-react';
import * as api from '../api';
import { useLang } from '../i18n';
import { useAuth } from '../AuthContext';
import { useClearedNotifications } from '../ClearedNotificationsContext';
import { PageHead, Spinner, EmptyState, Stat, Chip, type ChipTone, fmtNum, fmtDate } from '../components';
import { SortTh, sortRows, useTableSort } from '../tableSort';

// Logistics status shown in the "Holat" column. `warehouseStatus` (admin-set)
// wins; otherwise it is derived from the customs regime.
const STATUS_META: Record<api.ClearedStatus, { tone: ChipTone; key: string }> = {
  customs: { tone: 'green', key: 'regime.customs' },
  transit: { tone: 'amber', key: 'regime.transit' },
  company: { tone: 'blue', key: 'regime.company' },
};
const effectiveStatus = (r: api.ClearedRow): api.ClearedStatus =>
  r.warehouseStatus ?? ((r.regime || '').toUpperCase().includes('INCOMING') ? 'transit' : 'customs');

export default function ClearedProductsPage() {
  const { t } = useLang();
  const { role } = useAuth();
  const { refreshCleared } = useClearedNotifications();
  const isAdmin = role === 'admin' || role === 'sysadmin';
  const [q, setQ] = useState('');
  const [data, setData] = useState<api.ClearedList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
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

  const acceptAll = async () => {
    setBusy('ack');
    try { await api.acknowledgeCleared(); await load(); refreshCleared(); }
    catch (e) { window.alert((e as Error).message); }
    finally { setBusy(null); }
  };

  const changeStatus = async (id: string, status: api.ClearedStatus) => {
    setBusy(id);
    try { await api.setClearedStatus(id, status); await load(); }
    catch (e) { window.alert((e as Error).message); }
    finally { setBusy(null); }
  };

  const removeRow = async (id: string) => {
    if (!window.confirm(t('cleared.confirmDelete'))) return;
    setBusy(id);
    try { await api.deleteCleared(id); await load(); refreshCleared(); }
    catch (e) { window.alert((e as Error).message); }
    finally { setBusy(null); }
  };

  const unacknowledged = data?.unacknowledged ?? 0;

  return (
    <>
      <PageHead icon={<PackageCheck size={24} />} title={t('cleared.title')} sub={t('cleared.sub')} />

      {unacknowledged > 0 && (
        <div className="new-banner" role="status">
          <BellRing size={18} />
          <span>{t('cleared.newBanner').replace('{count}', String(unacknowledged))}</span>
          <button type="button" className="new-banner-btn" onClick={acceptAll} disabled={busy === 'ack'}>
            <Check size={15} /> {t('cleared.acknowledge')}
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
                  {isAdmin && <th style={{ width: 60 }}>{t('cleared.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {data && sortRows(data.items, sort.key, sort.direction, (row, key) => row[key as keyof api.ClearedRow] as string | number | null).map((r) => {
                  const st = effectiveStatus(r);
                  const meta = STATUS_META[st];
                  const isNew = !r.acknowledged;
                  return (
                    <tr key={r.id} className={isNew ? 'row-new' : ''}>
                      <td>
                        <div className="cell-strong">{r.productName}</div>
                      </td>
                      <td>{r.invoiceName}</td>
                      <td>{r.seriesBatch ? <span className="series-chip">{r.seriesBatch}</span> : '—'}</td>
                      <td>
                        {isAdmin ? (
                          <select
                            className="field cleared-status"
                            value={st}
                            disabled={busy === r.id}
                            onChange={(e) => changeStatus(r.id, e.target.value as api.ClearedStatus)}
                          >
                            <option value="customs">{t('regime.customs')}</option>
                            <option value="transit">{t('regime.transit')}</option>
                            <option value="company">{t('regime.company')}</option>
                          </select>
                        ) : (
                          <Chip tone={meta.tone}>{t(meta.key)}</Chip>
                        )}
                      </td>
                      <td className="num"><span className="qty-strong">{fmtNum(r.qty)}</span></td>
                      <td className="num">{r.pallets != null ? fmtNum(r.pallets) : '—'}</td>
                      <td className="num">{r.boxes != null ? fmtNum(r.boxes) : '—'}</td>
                      <td style={{ maxWidth: 260, whiteSpace: 'normal', color: 'var(--text-soft)' }}>{r.comment || '—'}</td>
                      <td>{fmtDate(r.clearedAt)}</td>
                      {isAdmin && (
                        <td>
                          <button
                            type="button"
                            className="cleared-del-btn"
                            title={t('cleared.delete')}
                            aria-label={t('cleared.delete')}
                            disabled={busy === r.id}
                            onClick={() => removeRow(r.id)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      )}
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
