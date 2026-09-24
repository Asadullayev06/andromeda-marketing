import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Archive, FileBadge, FilePlus2, FileText, Pencil, RotateCcw, Search, Trash2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import * as api from '../api';
import { useAuth } from '../AuthContext';
import { Chip, EmptyState, fmtDate, fmtNum, PageHead, Spinner } from '../components';
import { useLang } from '../i18n';
import { SortTh, sortRows, useTableSort } from '../tableSort';

const emptyBatch = (): api.ConformityBatch => ({ batch: null, quantity: null });
const emptyLine = (): api.ConformityProductLine => ({ name: '', expiry: null, batches: [emptyBatch()] });
const emptyInput = (): api.ConformityInput => ({
  certificateNumber: '', notes: null, productLines: [emptyLine()],
});

export default function ConformityCertificatesPage() {
  const { t } = useLang();
  const { role } = useAuth();
  const canManage = role === 'admin' || role === 'sysadmin';
  const [rows, setRows] = useState<api.ConformityCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<api.ConformityCertificate | null | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savedCertificate, setSavedCertificate] = useState<api.ConformityCertificate | null>(null);
  const sort = useTableSort<'certificateNumber' | 'products' | 'expiry'>('certificateNumber', 'asc');

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api.listConformityCertificates()); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('common.error')); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const needle = query.trim().toLocaleLowerCase();
  const filtered = rows.filter((row) => (showArchived || !row.archived) && (!needle || [
    row.certificateNumber, row.documentName,
    ...row.productLines.flatMap((line) => [line.name, ...line.batches.map((batch) => batch.batch ?? '')]),
  ].some((value) => value.toLocaleLowerCase().includes(needle))));
  const sorted = sortRows(filtered, sort.key, sort.direction, (row, key) => {
    if (key === 'products') return row.productLines.map((line) => line.name).join(', ');
    if (key === 'expiry') return row.productLines.map((line) => line.expiry ?? '').filter(Boolean).sort()[0] ?? '';
    if (key === 'certificateNumber') return row.certificateNumber;
    return '';
  }).sort((a, b) => Number(b.id === savedCertificate?.id) - Number(a.id === savedCertificate?.id));

  async function openDocument(row: api.ConformityCertificate) {
    const tab = window.open('', '_blank');
    setBusyId(row.id);
    try {
      const blob = await api.conformityDocument(row.id);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else { const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.click(); }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      tab?.close();
      setError(cause instanceof Error ? cause.message : t('common.error'));
    } finally { setBusyId(null); }
  }

  async function toggleArchive(row: api.ConformityCertificate) {
    setBusyId(row.id);
    try { await api.setConformityArchived(row.id, !row.archived); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('common.error')); }
    finally { setBusyId(null); }
  }

  async function deleteRow(row: api.ConformityCertificate) {
    if (!window.confirm(t('conformity.deleteConfirm'))) return;
    setBusyId(row.id);
    try { await api.deleteConformityCertificate(row.id); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('common.error')); }
    finally { setBusyId(null); }
  }

  return <>
    <PageHead icon={<FileBadge size={24} />} title={t('conformity.title')} sub={t('conformity.sub')}
      actions={canManage ? <Button onClick={() => { setSavedCertificate(null); setEditing(null); }}><FilePlus2 data-icon="inline-start" />{t('conformity.create')}</Button> : undefined} />
    <div className="toolbar">
      <div className="search"><Search size={18} /><Input value={query} onChange={(event) => { setQuery(event.target.value); setSavedCertificate(null); }} placeholder={t('conformity.search')} /></div>
      <label className="chk"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />{t('conformity.showArchived')}</label>
    </div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {savedCertificate && <Alert role="status"><AlertDescription>{t('conformity.saved')}: {savedCertificate.certificateNumber}</AlertDescription></Alert>}
    {loading && rows.length === 0 ? <Spinner label={t('common.loading')} /> : <div className="table-wrap">
      {filtered.length === 0 ? <EmptyState title={t('conformity.empty')} /> : <div className="table-scroll frozen"><table className="data">
        <thead><tr>
          <SortTh label={t('conformity.number')} column="certificateNumber" sort={sort} />
          <SortTh label={t('conformity.products')} column="products" sort={sort} />
          <SortTh label={t('conformity.expiry')} column="expiry" sort={sort} />
          <th>{t('conformity.download')}</th>
        </tr></thead>
        <tbody>{sorted.map((row) => <tr key={row.id}>
          <td>
            <div className="cell-strong">{row.certificateNumber}</div>
            {!row.archived ? null : <Chip tone="slate">{t('conformity.archived')}</Chip>}
          </td>
          <td>{row.productLines.map((line, index) => <div key={`${line.name}-${index}`}><strong>{line.name}</strong><div className="cell-sub">{line.batches.map((batch) => batch.batch || '—').join(', ')}</div></div>)}</td>
          <td>{row.productLines.map((line, index) => <div key={`${line.name}-${index}`}>{line.expiry ? fmtDate(line.expiry) : '—'}</div>)}</td>
          <td><div className="flex gap-1">
            <Button variant="ghost" size="sm" title={row.documentName} disabled={busyId === row.id} onClick={() => void openDocument(row)}><FileText data-icon="inline-start" />PDF</Button>
            {canManage && <Button variant="ghost" size="sm" aria-label={t('action.edit')} onClick={() => { setSavedCertificate(null); setEditing(row); }}><Pencil /></Button>}
            {canManage && <Button variant="ghost" size="sm" aria-label={t(row.archived ? 'conformity.restore' : 'conformity.archive')} disabled={busyId === row.id} onClick={() => void toggleArchive(row)}>{row.archived ? <RotateCcw /> : <Archive />}</Button>}
            {canManage && <Button variant="ghost" size="sm" aria-label={t('conformity.delete')} disabled={busyId === row.id} onClick={() => void deleteRow(row)}><Trash2 /></Button>}
          </div></td>
        </tr>)}</tbody>
      </table></div>}
      <div className="table-foot">{fmtNum(filtered.length)} {t('common.results')}</div>
    </div>}
    {editing !== undefined && <CertificateEditor key={editing?.id ?? 'new'} row={editing} onClose={() => setEditing(undefined)} onSaved={(saved) => {
      setRows((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setQuery(saved.certificateNumber);
      setShowArchived(false);
      setSavedCertificate(saved);
      setError('');
      setEditing(undefined);
    }} />}
  </>;
}

function CertificateEditor({ row, onClose, onSaved }: { row: api.ConformityCertificate | null; onClose: () => void; onSaved: (saved: api.ConformityCertificate) => void }) {
  const { t } = useLang();
  const [input, setInput] = useState<api.ConformityInput>(() => row ? {
    certificateNumber: row.certificateNumber,
    notes: row.notes,
    productLines: row.productLines.map((line) => ({ ...line, batches: line.batches.map((batch) => ({ ...batch })) })),
  } : emptyInput());
  const [file, setFile] = useState<File | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [products, setProducts] = useState<string[]>([]);
  useEffect(() => { void api.productNames().then(setProducts).catch(() => undefined); }, []);
  const lineField = (index: number, value: string) => setInput((current) => ({ ...current, productLines: current.productLines.map((line, i) => i === index ? { ...line, name: value } : line) }));
  const lineExpiry = (index: number, value: string) => setInput((current) => ({ ...current, productLines: current.productLines.map((line, i) => i === index ? { ...line, expiry: value || null } : line) }));
  const batchField = (productIndex: number, batchIndex: number, key: keyof api.ConformityBatch, value: string) => setInput((current) => ({
    ...current,
    productLines: current.productLines.map((line, i) => i === productIndex ? {
      ...line, batches: line.batches.map((batch, j) => j === batchIndex ? { ...batch, [key]: value || null } : batch),
    } : line),
  }));
  const addBatch = (productIndex: number) => setInput((current) => ({
    ...current,
    productLines: current.productLines.map((line, i) => i === productIndex ? { ...line, batches: [...line.batches, emptyBatch()] } : line),
  }));
  const removeBatch = (productIndex: number, batchIndex: number) => setInput((current) => ({
    ...current,
    productLines: current.productLines.map((line, i) => i === productIndex ? {
      ...line, batches: line.batches.filter((_, j) => j !== batchIndex),
    } : line),
  }));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!row && !file) { setError(t('conformity.pdfRequired')); return; }
    setSaving(true); setError('');
    try { const saved = await api.saveConformityCertificate(input, file, row?.id); onSaved(saved); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('common.error')); }
    finally { setSaving(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[820px]">
    <DialogHeader><DialogTitle>{t(row ? 'conformity.edit' : 'conformity.create')}</DialogTitle><DialogDescription>{t('conformity.formHint')}</DialogDescription></DialogHeader>
    <form onSubmit={(event) => void save(event)} className="conformity-form">
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <datalist id="conformity-product-names">{products.map((name) => <option key={name} value={name} />)}</datalist>
      <label>{t('conformity.number')}<Input required value={input.certificateNumber} onChange={(e) => setInput((current) => ({ ...current, certificateNumber: e.target.value }))} /></label>
      <div className="conformity-lines-head"><strong>{t('conformity.products')}</strong><Button type="button" variant="outline" size="sm" onClick={() => setInput((current) => ({ ...current, productLines: [...current.productLines, emptyLine()] }))}>{t('conformity.addProduct')}</Button></div>
      {input.productLines.map((line, index) => <div className="conformity-product" key={index}>
        <div className="conformity-product-head">
          <strong>{t('conformity.product')} {index + 1}</strong>
          {input.productLines.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => setInput((current) => ({ ...current, productLines: current.productLines.filter((_, i) => i !== index) }))}>{t('conformity.removeProduct')}</Button>}
        </div>
        <label>{t('conformity.productName')}<Input required list="conformity-product-names" placeholder={t('conformity.selectProduct')} value={line.name} onChange={(e) => lineField(index, e.target.value)} /></label>
        <label>{t('conformity.expiry')}<Input type="date" value={line.expiry ?? ''} onChange={(e) => lineExpiry(index, e.target.value)} /></label>
        <div className="conformity-batches-head"><strong>{t('conformity.batches')}</strong><Button type="button" variant="outline" size="sm" onClick={() => addBatch(index)}>{t('conformity.addBatch')}</Button></div>
        {line.batches.map((batch, batchIndex) => <div className="conformity-batch" key={batchIndex}>
          <label>{t('conformity.batch')}<Input value={batch.batch ?? ''} onChange={(e) => batchField(index, batchIndex, 'batch', e.target.value)} /></label>
          {line.batches.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => removeBatch(index, batchIndex)}>{t('conformity.removeBatch')}</Button>}
        </div>)}
      </div>)}
      <label>{t('conformity.notes')}<textarea className="field conformity-notes" value={input.notes ?? ''} onChange={(e) => setInput((current) => ({ ...current, notes: e.target.value }))} /></label>
      <label>{t('conformity.pdf')}<Input required={!row} type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0])} />{row && <span className="cell-sub">{row.documentName} · {fmtNum(row.documentSizeBytes)} bytes</span>}</label>
      <div className="conformity-form-actions"><Button type="button" variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button type="submit" disabled={saving}>{saving ? t('conformity.saving') : t('action.save')}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
