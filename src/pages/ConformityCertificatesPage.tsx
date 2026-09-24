import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Archive, FileBadge, FilePlus2, FileText, Pencil, RotateCcw, Search } from 'lucide-react';
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
const emptyLine = (): api.ConformityProductLine => ({ name: '', batches: [emptyBatch()] });
const emptyInput = (): api.ConformityInput => ({
  notes: null, productLines: [emptyLine()],
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
  const sort = useTableSort<'products' | 'documentName' | 'createdAt' | 'status'>('createdAt', 'desc');

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api.listConformityCertificates()); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('common.error')); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const needle = query.trim().toLocaleLowerCase();
  const filtered = rows.filter((row) => (showArchived || !row.archived) && (!needle || [
    row.documentName,
    ...row.productLines.flatMap((line) => [line.name, ...line.batches.map((batch) => batch.batch ?? '')]),
  ].some((value) => value.toLocaleLowerCase().includes(needle))));
  const sorted = sortRows(filtered, sort.key, sort.direction, (row, key) => {
    if (key === 'products') return row.productLines.map((line) => line.name).join(', ');
    if (key === 'status') return row.archived ? 'archived' : 'active';
    return row[key as Exclude<typeof sort.key, 'products' | 'status'>];
  });

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

  return <>
    <PageHead icon={<FileBadge size={24} />} title={t('conformity.title')} sub={t('conformity.sub')}
      actions={canManage ? <Button onClick={() => setEditing(null)}><FilePlus2 data-icon="inline-start" />{t('conformity.create')}</Button> : undefined} />
    <div className="toolbar">
      <div className="search"><Search size={18} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('conformity.search')} /></div>
      <label className="chk"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />{t('conformity.showArchived')}</label>
    </div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {loading && rows.length === 0 ? <Spinner label={t('common.loading')} /> : <div className="table-wrap">
      {filtered.length === 0 ? <EmptyState title={t('conformity.empty')} /> : <div className="table-scroll frozen"><table className="data">
        <thead><tr>
          <SortTh label={t('conformity.products')} column="products" sort={sort} />
          <SortTh label={t('conformity.pdf')} column="documentName" sort={sort} />
          <SortTh label={t('conformity.added')} column="createdAt" sort={sort} />
          <SortTh label={t('conformity.status')} column="status" sort={sort} />
          <th>{t('conformity.actions')}</th>
        </tr></thead>
        <tbody>{sorted.map((row) => <tr key={row.id}>
          <td>{row.productLines.map((line, index) => <div key={`${line.name}-${index}`}><strong>{line.name}</strong><div className="cell-sub">{line.batches.map((batch) => batch.batch || '—').join(', ')}</div></div>)}</td>
          <td>{row.documentName}</td><td>{fmtDate(row.createdAt)}</td>
          <td><Chip tone={row.archived ? 'slate' : 'green'}>{t(row.archived ? 'conformity.archived' : 'conformity.active')}</Chip></td>
          <td><div className="flex gap-1">
            <Button variant="ghost" size="sm" title={row.documentName} disabled={busyId === row.id} onClick={() => void openDocument(row)}><FileText data-icon="inline-start" />PDF</Button>
            {canManage && <Button variant="ghost" size="sm" aria-label={t('action.edit')} onClick={() => setEditing(row)}><Pencil /></Button>}
            {canManage && <Button variant="ghost" size="sm" aria-label={t(row.archived ? 'conformity.restore' : 'conformity.archive')} disabled={busyId === row.id} onClick={() => void toggleArchive(row)}>{row.archived ? <RotateCcw /> : <Archive />}</Button>}
          </div></td>
        </tr>)}</tbody>
      </table></div>}
      <div className="table-foot">{fmtNum(filtered.length)} {t('common.results')}</div>
    </div>}
    {editing !== undefined && <CertificateEditor key={editing?.id ?? 'new'} row={editing} onClose={() => setEditing(undefined)} onSaved={async () => { setEditing(undefined); await load(); }} />}
  </>;
}

function CertificateEditor({ row, onClose, onSaved }: { row: api.ConformityCertificate | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useLang();
  const [input, setInput] = useState<api.ConformityInput>(() => row ? {
    notes: row.notes,
    productLines: row.productLines.map((line) => ({ ...line, batches: line.batches.map((batch) => ({ ...batch })) })),
  } : emptyInput());
  const [file, setFile] = useState<File | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const lineField = (index: number, value: string) => setInput((current) => ({ ...current, productLines: current.productLines.map((line, i) => i === index ? { ...line, name: value } : line) }));
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
    try { await api.saveConformityCertificate(input, file, row?.id); await onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('common.error')); }
    finally { setSaving(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[820px]">
    <DialogHeader><DialogTitle>{t(row ? 'conformity.edit' : 'conformity.create')}</DialogTitle><DialogDescription>{t('conformity.formHint')}</DialogDescription></DialogHeader>
    <form onSubmit={(event) => void save(event)} className="conformity-form">
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="conformity-lines-head"><strong>{t('conformity.products')}</strong><Button type="button" variant="outline" size="sm" onClick={() => setInput((current) => ({ ...current, productLines: [...current.productLines, emptyLine()] }))}>{t('conformity.addProduct')}</Button></div>
      {input.productLines.map((line, index) => <div className="conformity-product" key={index}>
        <div className="conformity-product-head">
          <strong>{t('conformity.product')} {index + 1}</strong>
          {input.productLines.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => setInput((current) => ({ ...current, productLines: current.productLines.filter((_, i) => i !== index) }))}>{t('conformity.removeProduct')}</Button>}
        </div>
        <label>{t('conformity.productName')}<Input required value={line.name} onChange={(e) => lineField(index, e.target.value)} /></label>
        <div className="conformity-batches-head"><strong>{t('conformity.batches')}</strong><Button type="button" variant="outline" size="sm" onClick={() => addBatch(index)}>{t('conformity.addBatch')}</Button></div>
        {line.batches.map((batch, batchIndex) => <div className="conformity-batch" key={batchIndex}>
          <label>{t('conformity.batch')}<Input value={batch.batch ?? ''} onChange={(e) => batchField(index, batchIndex, 'batch', e.target.value)} /></label>
          <label>{t('conformity.quantity')}<Input value={batch.quantity ?? ''} onChange={(e) => batchField(index, batchIndex, 'quantity', e.target.value)} /></label>
          {line.batches.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => removeBatch(index, batchIndex)}>{t('conformity.removeBatch')}</Button>}
        </div>)}
      </div>)}
      <label>{t('conformity.notes')}<textarea className="field conformity-notes" value={input.notes ?? ''} onChange={(e) => setInput((current) => ({ ...current, notes: e.target.value }))} /></label>
      <label>{t('conformity.pdf')}<Input required={!row} type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0])} />{row && <span className="cell-sub">{row.documentName} · {fmtNum(row.documentSizeBytes)} bytes</span>}</label>
      <div className="conformity-form-actions"><Button type="button" variant="outline" onClick={onClose}>{t('action.cancel')}</Button><Button type="submit" disabled={saving}>{saving ? t('conformity.saving') : t('action.save')}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
