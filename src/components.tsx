import type { ReactNode } from 'react';
import { CheckCircle2, Hourglass, Inbox } from 'lucide-react';

export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(n);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

export function fmtMonth(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('ru-RU', { month: 'short', year: '2-digit' }).format(d);
}

export function PageHead({ icon, title, sub, actions }: {
  icon: ReactNode; title: string; sub?: string; actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="page-title">
        <div className="icon">{icon}</div>
        <div>
          <h1>{title}</h1>
          {sub && <p className="sub">{sub}</p>}
        </div>
      </div>
      {actions && <div style={{ display: 'flex', gap: 10 }}>{actions}</div>}
    </div>
  );
}

export function Stat({ icon, tone, label, value, hint }: {
  icon: ReactNode; tone: 'blue' | 'green' | 'amber' | 'violet'; label: string; value: string; hint?: string;
}) {
  return (
    <div className="stat">
      <div className={`stat-icon i-${tone}`}>{icon}</div>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {hint && <div className="stat-hint">{hint}</div>}
      </div>
    </div>
  );
}

export type ChipTone = 'green' | 'amber' | 'red' | 'blue' | 'slate';
export function Chip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return <span className={`chip ${tone}`}><span className="dot" />{children}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="loading">
      <div className="spinner" />
      {label}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <Inbox size={46} />
      <h3>{title}</h3>
      {hint && <div>{hint}</div>}
    </div>
  );
}

export interface StepDef { label: string; state: 'done' | 'current' | 'pending'; }
export function Stepper({ steps }: { steps: StepDef[] }) {
  return (
    <div className="stepper">
      {steps.map((s, i) => (
        <div key={i} className={`step ${s.state}`}>
          <div className="connector" />
          <div className="bubble">
            {s.state === 'done' ? <CheckCircle2 size={26} /> : <Hourglass size={22} />}
          </div>
          <div className="step-label">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

// Grouped bar chart (dispatched vs sold) rendered as inline SVG — no chart lib.
export function GroupedBars({ data, labels, colorA, colorB, height = 240 }: {
  data: { label: string; a: number; b: number }[];
  labels: [string, string];
  colorA: string; colorB: string; height?: number;
}) {
  const width = Math.max(560, data.length * 74);
  const pad = { top: 16, right: 16, bottom: 34, left: 52 };
  const innerH = height - pad.top - pad.bottom;
  const innerW = width - pad.left - pad.right;
  const max = Math.max(1, ...data.map((d) => Math.max(d.a, d.b)));
  const groupW = innerW / Math.max(1, data.length);
  const barW = Math.min(20, groupW / 3);
  const yTicks = 4;

  return (
    <div>
      <div className="chart-legend">
        <div className="lg"><span className="sw" style={{ background: colorA }} />{labels[0]}</div>
        <div className="lg"><span className="sw" style={{ background: colorB }} />{labels[1]}</div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg width={width} height={height} role="img">
          {Array.from({ length: yTicks + 1 }).map((_, i) => {
            const y = pad.top + (innerH / yTicks) * i;
            const val = max - (max / yTicks) * i;
            return (
              <g key={i}>
                <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke="#eef1f7" strokeWidth={1} />
                <text x={pad.left - 8} y={y + 4} textAnchor="end" fontSize={11} fill="#8a95ad">
                  {fmtNum(Math.round(val))}
                </text>
              </g>
            );
          })}
          {data.map((d, i) => {
            const gx = pad.left + groupW * i + groupW / 2;
            const aH = (d.a / max) * innerH;
            const bH = (d.b / max) * innerH;
            return (
              <g key={i}>
                <rect x={gx - barW - 3} y={pad.top + innerH - aH} width={barW} height={aH} rx={4} fill={colorA} />
                <rect x={gx + 3} y={pad.top + innerH - bH} width={barW} height={bH} rx={4} fill={colorB} />
                <text x={gx} y={height - 12} textAnchor="middle" fontSize={11} fill="#56617a">{d.label}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
