import { useEffect, useMemo, useRef, useState } from 'react';
import { PackageCheck, Search, Layers, Boxes as BoxesIcon, Check, Trash2, FileText, ShieldAlert, Upload, X } from 'lucide-react';
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

// Red "no sale permission" / green "sellable" badge for ND-40 goods. When
// `onEdit` is set (admin on the awaiting-certificate tab) the badge is a button
// that opens the release/edit dialog.
function SaleBadge({ row, onEdit }: { row: api.ClearedRow; onEdit?: () => void }) {
  const { t } = useLang();
  if (!row.noSalePermission) return null;
  const released = row.saleReleased;
  const cls = released ? 'sellable-badge' : 'no-sale-badge';
  const inner = released
    ? <><Check size={12} /> {t('cleared.sellable')}</>
    : <><ShieldAlert size={12} /> {t('cleared.noSale')}</>;
  if (onEdit) {
    return <button type="button" className={`${cls} badge-btn`} onClick={onEdit} title={t('cleared.editRelease')}>{inner}</button>;
  }
  return <span className={cls} title={released ? t('cleared.sellableHint') : t('cleared.noSaleHint')}>{inner}</span>;
}

export default function ClearedProductsPage() {
  const { t } = useLang();
  const { role } = useAuth();
  const { refreshCleared } = useClearedNotifications();
  const isAdmin = role === 'admin' || role === 'sysadmin';
  const [view, setView] = useState<api.ClearedView>('pending');
  const [q, setQ] = useState('');
  const [data, setData] = useState<api.ClearedList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const sort = useTableSort<keyof api.ClearedRow>('productName');
  const debounce = useRef<number | undefined>(undefined);

  const load = useMemo(() => async () => {
    setLoading(true);
    try {
      setData(await api.listCleared({ q, view }));
    } finally {
      setLoading(false);
    }
  }, [q, view]);

  useEffect(() => {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(load, 250);
    return () => window.clearTimeout(debounce.current);
  }, [load]);

  // Poll for freshly cleared goods while the tab is visible.
  useEffect(() => {
    const id = window.setInterval(() => { if (!document.hidden) load(); }, 60000);
    return () => window.clearInterval(id);
  }, [load]);

  const accept = async (id: string) => {
    setBusy(id);
    try { await api.acknowledgeCleared(id); await load(); refreshCleared(); }
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

  const openDocument = async (id: string) => {
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      const url = await api.clearanceDocumentUrl(id);
      if (tab) tab.location.replace(url);
      else window.location.assign(url);
    } catch (e) {
      tab?.close();
      window.alert((e as Error).message);
    }
  };

  const [releaseRow, setReleaseRow] = useState<api.ClearedRow | null>(null);
  const onReleased = () => { setReleaseRow(null); load(); refreshCleared(); };

  const isPending = view === 'pending';
  const isAwaiting = view === 'awaiting_cert';

  return (
    <>
      <PageHead icon={<PackageCheck size={24} />} title={t('cleared.title')} sub={t('cleared.sub')} />

      <div className="pill-row" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button type="button" className={`pill ${isPending ? 'active' : ''}`} onClick={() => setView('pending')}>
          {t('cleared.tabPending')}
        </button>
        <button type="button" className={`pill ${isAwaiting ? 'active' : ''}`} onClick={() => setView('awaiting_cert')}>
          {t('cleared.tabAwaitingCert')}
        </button>
        <button type="button" className={`pill ${view === 'archived' ? 'active' : ''}`} onClick={() => setView('archived')}>
          {t('cleared.tabArchived')}
        </button>
      </div>

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
        <div className="table-wrap"><EmptyState title={isPending ? t('cleared.emptyPending') : isAwaiting ? t('cleared.emptyAwaitingCert') : t('cleared.emptyArchived')} /></div>
      ) : (
        <div className="table-wrap">
          <div className="table-scroll frozen">
            <table className="data">
              <thead>
                <tr>
                  <SortTh label={t('common.product')} column="productName" sort={sort} />
                  <SortTh label={t('cleared.manufacturer')} column="manufacturer" sort={sort} />
                  <SortTh label={t('cleared.invoice')} column="invoiceName" sort={sort} />
                  <SortTh label={t('cleared.series')} column="seriesBatch" sort={sort} />
                  <SortTh label={t('customs.regime')} column="regime" sort={sort} />
                  <SortTh label={t('common.qty')} column="qty" sort={sort} numeric />
                  <SortTh label={t('cleared.pallets')} column="pallets" sort={sort} numeric />
                  <SortTh label={t('cleared.boxes')} column="boxes" sort={sort} numeric />
                  <SortTh label={t('cleared.comment')} column="comment" sort={sort} />
                  <th>{t('cleared.documents')}</th>
                  <SortTh label={t('cleared.expiry')} column="productExpiry" sort={sort} />
                  <th>{t('cleared.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {data && sortRows(data.items, sort.key, sort.direction, (row, key) => row[key as keyof api.ClearedRow] as string | number | null).map((r) => {
                  const st = effectiveStatus(r);
                  const meta = STATUS_META[st];
                  return (
                    <tr key={r.id}>
                      <td>
                        <div className="cell-strong">{r.productName}</div>
                        <SaleBadge row={r} onEdit={isAwaiting && isAdmin ? () => setReleaseRow(r) : undefined} />
                      </td>
                      <td>{r.manufacturer || '—'}</td>
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
                      <td>
                        {r.documents.length ? r.documents.map((doc) => (
                          <button
                            key={doc.id}
                            type="button"
                            className="cleared-document-btn"
                            title={doc.fileName}
                            onClick={() => openDocument(doc.id)}
                          >
                            <FileText size={14} /> {doc.documentType === 'im40' || /^(?:im|им)[\s_-]*40/i.test(doc.fileName) ? 'IM-40'
                              : doc.documentType === 'invoice' || /^(?:invoice|inv[\s_-]|инв)/i.test(doc.fileName) ? t('cleared.invoice')
                              : doc.documentType === 'packing_list' || /^(?:packing|упаков|пак(?:инг)?)/i.test(doc.fileName) ? t('cleared.packingList')
                              : doc.fileName}
                          </button>
                        )) : '—'}
                      </td>
                      <td>{r.productExpiry ? fmtDate(r.productExpiry) : '—'}</td>
                      <td>
                          <div className="cleared-actions">
                            {isPending ? (
                              <button
                                type="button"
                                className="cleared-accept-btn"
                                disabled={busy === r.id}
                                onClick={() => accept(r.id)}
                              >
                                <Check size={14} /> {t('cleared.acknowledge')}
                              </button>
                            ) : isAwaiting ? (
                              isAdmin ? (
                                <button
                                  type="button"
                                  className="cleared-release-btn"
                                  onClick={() => setReleaseRow(r)}
                                >
                                  <Upload size={14} /> {r.saleReleased ? t('cleared.editDocs') : t('cleared.release')}
                                </button>
                              ) : (
                                <SaleBadge row={r} />
                              )
                            ) : (
                              <span className="cleared-done-badge">
                                <Check size={14} /> {t('cleared.acknowledged')}
                              </span>
                            )}
                            {isAdmin && (
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
                            )}
                          </div>
                        </td>
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

      {releaseRow && (
        <ReleaseModal row={releaseRow} onClose={() => setReleaseRow(null)} onDone={onReleased} />
      )}
    </>
  );
}

type DocDraft = {
  id: number;
  file: File | null;
  documentType: string;
  mode: 'everyone' | 'specific';
  selected: Set<string>;
};

const newDoc = (id: number, documentType: string): DocDraft =>
  ({ id, file: null, documentType, mode: 'everyone', selected: new Set() });

function ReleaseModal({ row, onClose, onDone }: { row: api.ClearedRow; onClose: () => void; onDone: () => void }) {
  const { t } = useLang();
  const [docs, setDocs] = useState<DocDraft[]>([newDoc(1, 'certificate'), newDoc(2, 'im40')]);
  const [recipients, setRecipients] = useState<api.DocumentRecipient[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const nextId = useRef(3);

  useEffect(() => {
    api.clearedDocumentRecipients().then(setRecipients).catch(() => setRecipients([]));
  }, []);

  const addDoc = () => setDocs((d) => [...d, newDoc(nextId.current++, 'other')]);
  const removeDoc = (id: number) => setDocs((d) => (d.length > 1 ? d.filter((x) => x.id !== id) : d));
  const patch = (id: number, p: Partial<DocDraft>) => setDocs((d) => d.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const toggleUser = (id: number, uid: string) => setDocs((d) => d.map((x) => {
    if (x.id !== id) return x;
    const next = new Set(x.selected);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    return { ...x, selected: next };
  }));

  const ready = docs.every((d) => d.file && (d.mode === 'everyone' || d.selected.size > 0));

  const submit = async () => {
    if (!ready) return;
    setSubmitting(true);
    try {
      await api.releaseClearedSale(row.id, docs.map((d) => ({
        file: d.file as File,
        documentType: d.documentType,
        recipients: d.mode === 'everyone' ? 'everyone' : Array.from(d.selected),
      })));
      onDone();
    } catch (e) {
      window.alert((e as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal release-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{t('cleared.releaseTitle')}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('action.close')}><X size={18} /></button>
        </div>
        <p className="modal-sub">{row.productName} · {row.invoiceName}</p>

        <div className="release-section">
          {docs.map((d) => (
            <div key={d.id} className="release-doc-card">
              <div className="release-doc-row">
                <select className="field" value={d.documentType} onChange={(e) => patch(d.id, { documentType: e.target.value })}>
                  <option value="im40">IM-40</option>
                  <option value="certificate">{t('cleared.docCertificate')}</option>
                  <option value="invoice">{t('cleared.docInvoice')}</option>
                  <option value="other">{t('cleared.docOther')}</option>
                </select>
                <input type="file" onChange={(e) => patch(d.id, { file: e.target.files?.[0] ?? null })} />
                {docs.length > 1 && (
                  <button type="button" className="cleared-del-btn" onClick={() => removeDoc(d.id)} aria-label={t('cleared.delete')}>
                    <X size={14} />
                  </button>
                )}
              </div>
              <div className="release-who">
                <span className="release-who-label">{t('cleared.whoCanSee')}:</span>
                <label><input type="radio" checked={d.mode === 'everyone'} onChange={() => patch(d.id, { mode: 'everyone' })} /> {t('cleared.everyone')}</label>
                <label><input type="radio" checked={d.mode === 'specific'} onChange={() => patch(d.id, { mode: 'specific' })} /> {t('cleared.specificUsers')}</label>
              </div>
              {d.mode === 'specific' && (
                <div className="release-user-list">
                  {recipients.map((u) => (
                    <label key={u.id} className="release-user">
                      <input type="checkbox" checked={d.selected.has(u.id)} onChange={() => toggleUser(d.id, u.id)} />
                      {u.displayName}
                    </label>
                  ))}
                  {recipients.length === 0 && <span className="modal-sub">—</span>}
                </div>
              )}
            </div>
          ))}
          <button type="button" className="release-add-btn" onClick={addDoc}>+ {t('cleared.addDocument')}</button>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>{t('action.cancel')}</button>
          <button type="button" className="cleared-accept-btn" disabled={!ready || submitting} onClick={submit}>
            <Check size={14} /> {submitting ? t('common.loading') : t('cleared.release')}
          </button>
        </div>
      </div>
    </div>
  );
}
