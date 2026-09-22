import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, FileBadge, FileText, RefreshCw, Search } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import * as api from '../api';
import { Chip, EmptyState, PageHead, Spinner, Stat, fmtDate, fmtNum, type ChipTone } from '../components';
import { useLang } from '../i18n';

type StatusFilter = 'all' | 'valid' | 'expiring' | 'critical' | 'unknown';
type CertificateStatus = Exclude<StatusFilter, 'all'>;

const DAY_MS = 86_400_000;

function certificateStatus(validUntil: string | null): CertificateStatus {
  if (!validUntil) return 'unknown';
  const end = new Date(`${validUntil}T23:59:59`).getTime();
  if (!Number.isFinite(end)) return 'unknown';
  const days = Math.ceil((end - Date.now()) / DAY_MS);
  if (days <= 180) return 'critical';
  if (days <= 365) return 'expiring';
  return 'valid';
}

function statusTone(status: CertificateStatus): ChipTone {
  if (status === 'valid') return 'green';
  if (status === 'expiring') return 'amber';
  if (status === 'critical') return 'red';
  return 'slate';
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function CertificatesPage() {
  const { t } = useLang();
  const [rows, setRows] = useState<api.Certificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [openingId, setOpeningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await api.listCertificates());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('cert.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => {
    const result = { valid: 0, expiring: 0, critical: 0, unknown: 0 };
    rows.forEach((row) => { result[certificateStatus(row.validUntil)] += 1; });
    return result;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== 'all' && certificateStatus(row.validUntil) !== statusFilter) return false;
      if (!needle) return true;
      return [
        row.certificateNumber,
        row.tradeName,
        row.dosageForm,
        row.holderName,
        row.manufacturerName,
        ...row.productLinks.flatMap((link) => [link.catalogName, link.tradeName, link.dosageForm]),
      ].some((value) => value?.toLocaleLowerCase().includes(needle));
    });
  }, [query, rows, statusFilter]);

  async function openDocument(item: api.Certificate) {
    setOpeningId(item.id);
    setError('');
    try {
      const url = await api.certificateDocumentUrl(item.id);
      window.open(url, '_blank', 'noopener');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('cert.failed'));
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <>
      <PageHead icon={<FileBadge size={24} />} title={t('cert.library')} sub={t('cert.librarySub')} />

      <div className="stat-grid">
        <Stat tone="blue" icon={<FileBadge size={24} />} label={t('cert.total')} value={fmtNum(rows.length)} />
        <Stat tone="green" icon={<CheckCircle2 size={24} />} label={t('cert.valid')} value={fmtNum(stats.valid)} />
        <Stat tone="amber" icon={<CalendarClock size={24} />} label={t('cert.expiring')} value={fmtNum(stats.expiring)} />
        <Stat tone="red" icon={<AlertTriangle size={24} />} label={t('cert.critical')} value={fmtNum(stats.critical)} />
      </div>

      <div className="toolbar">
        <div className="search">
          <Search size={18} />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('cert.search')} />
        </div>
        <select className="field" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
          <option value="all">{t('cert.filterAll')}</option>
          <option value="valid">{t('cert.valid')}</option>
          <option value="expiring">{t('cert.expiring')}</option>
          <option value="critical">{t('cert.critical')}</option>
          <option value="unknown">{t('cert.unknown')}</option>
        </select>
        <Button variant="ghost" onClick={() => void load()} disabled={loading}>
          <RefreshCw data-icon="inline-start" /> {t('action.refresh')}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="certificate-alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && rows.length === 0 ? (
        <Spinner label={t('common.loading')} />
      ) : filtered.length === 0 ? (
        <div className="table-wrap"><EmptyState title={t('cert.empty')} hint={t('cert.emptySub')} /></div>
      ) : (
        <div className="table-wrap">
          <div className="table-scroll frozen certificate-table-scroll">
            <table className="data certificate-table">
              <thead>
                <tr>
                  <th>{t('cert.number')}</th>
                  <th>{t('cert.manufacturer')}</th>
                  <th>{t('cert.products')}</th>
                  <th>{t('cert.registeredOn')}</th>
                  <th>{t('cert.validUntil')}</th>
                  <th>{t('cert.status')}</th>
                  <th>{t('cert.document')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const status = certificateStatus(item.validUntil);
                  return (
                    <tr key={item.id}>
                      <td className="certificate-number">{item.certificateNumber}</td>
                      <td>
                        <div className="cell-strong">{item.manufacturerName || '—'}</div>
                        {item.manufacturerCountry && <div className="cell-sub">{item.manufacturerCountry}</div>}
                      </td>
                      <td>
                        <div className="certificate-products">
                          {item.productLinks.map((link, index) => (
                            <div key={`${link.productId ?? 'legacy'}-${index}`} className="certificate-product">
                              {link.catalogName !== link.tradeName && <span>{link.catalogName}</span>}
                              <strong>{link.tradeName}</strong>
                              {link.dosageForm && <small>{link.dosageForm}</small>}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td>{fmtDate(item.registrationDate)}</td>
                      <td>{fmtDate(item.validUntil)}</td>
                      <td><Chip tone={statusTone(status)}>{t(`cert.${status}`)}</Chip></td>
                      <td>
                        {item.documentName ? (
                          <Button variant="ghost" size="sm" onClick={() => void openDocument(item)} disabled={openingId === item.id} title={item.documentName}>
                            <FileText data-icon="inline-start" /> PDF {formatSize(item.documentSizeBytes)}
                          </Button>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <span>{fmtNum(filtered.length)} / {fmtNum(rows.length)} {t('common.results')}</span>
          </div>
        </div>
      )}
    </>
  );
}
