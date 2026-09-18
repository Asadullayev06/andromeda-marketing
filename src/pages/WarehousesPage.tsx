import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Warehouse, MapPin } from 'lucide-react';
import * as api from '../api';
import { useLang } from '../i18n';
import { PageHead, Spinner, EmptyState, fmtNum } from '../components';

export default function WarehousesPage() {
  const { t } = useLang();
  const nav = useNavigate();
  const [rows, setRows] = useState<api.WarehouseRow[] | null>(null);

  useEffect(() => { api.listWarehouses(false).then(setRows).catch(() => setRows([])); }, []);

  if (!rows) return <Spinner label={t('common.loading')} />;

  return (
    <>
      <PageHead icon={<Warehouse size={24} />} title={t('wh.title')} sub={t('wh.sub')} />
      {rows.length === 0 ? (
        <div className="card"><EmptyState title={t('common.none')} /></div>
      ) : (
        <div className="wh-grid">
          {rows.map((w) => (
            <div key={w.id} className="wh-card" onClick={() => nav(`/warehouses/${w.id}`)}>
              <div className="wh-top">
                <div className="wh-ico"><Warehouse size={24} /></div>
                {w.code && <span className="chip slate">{w.code}</span>}
              </div>
              <h3>{w.name}</h3>
              <div className="wh-meta">
                {w.projectName || '—'}
                {w.city && <> · <MapPin size={12} style={{ verticalAlign: 'middle' }} /> {w.city}</>}
              </div>
              <div className="wh-stats">
                <div className="wh-stat">
                  <div className="n">{fmtNum(w.productCount)}</div>
                  <div className="l">{t('wh.products')}</div>
                </div>
                <div className="wh-stat">
                  <div className="n" style={{ color: 'var(--primary-strong)' }}>{fmtNum(w.totalQty)}</div>
                  <div className="l">{t('wh.units')}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
