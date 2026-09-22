import { Badge } from "@/components/ui/badge";
import { useState, type PointerEvent, type ReactNode } from 'react';
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
  icon: ReactNode; tone: 'blue' | 'green' | 'amber' | 'violet' | 'red'; label: string; value: string; hint?: string;
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
  return <Badge variant={tone}><span className="size-1.5 rounded-full bg-current" />{children}</Badge>;
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
export function GroupedBars({ data, labels, colorA, colorB, height = 340 }: {
  data: { label: string; a: number; b: number }[];
  labels: [string, string];
  colorA: string; colorB: string; height?: number;
}) {
  const width = Math.max(620, data.length * 74);
  const pad = { top: 14, right: 12, bottom: 38, left: 58 };
  const innerH = height - pad.top - pad.bottom;
  const innerW = width - pad.left - pad.right;
  const max = Math.max(1, ...data.map((d) => Math.max(d.a, d.b)));
  const groupW = innerW / Math.max(1, data.length);
  const barW = Math.min(20, groupW / 3);
  const yTicks = 4;
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const active = activeIndex === null ? null : data[activeIndex];

  function trackPointer(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * (width / bounds.width);
    const index = Math.floor((x - pad.left) / groupW);
    setActiveIndex(index >= 0 && index < data.length ? index : null);
  }

  return (
    <div className="grouped-bars">
      <div className="chart-legend">
        <div className="lg"><span className="sw" style={{ background: colorA }} />{labels[0]}</div>
        <div className="lg"><span className="sw" style={{ background: colorB }} />{labels[1]}</div>
      </div>
      <div className="chart-scroll">
        <div className="chart-stage">
        <svg
          className="chart-canvas"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${labels[0]} / ${labels[1]}`}
          onPointerMove={trackPointer}
          onPointerLeave={() => setActiveIndex(null)}
        >
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
              <g
                key={i}
                className={activeIndex === i ? 'chart-group active' : 'chart-group'}
                tabIndex={0}
                aria-label={`${d.label}: ${labels[0]} ${fmtNum(d.a)}, ${labels[1]} ${fmtNum(d.b)}`}
                onFocus={() => setActiveIndex(i)}
                onBlur={() => setActiveIndex(null)}
              >
                <rect className="chart-hit-area" x={pad.left + groupW * i} y={pad.top} width={groupW} height={innerH} />
                <rect x={gx - barW - 3} y={pad.top + innerH - aH} width={barW} height={aH} rx={4} fill={colorA} />
                <rect x={gx + 3} y={pad.top + innerH - bH} width={barW} height={bH} rx={4} fill={colorB} />
                <text x={gx} y={height - 12} textAnchor="middle" fontSize={11} fill="#56617a">{d.label}</text>
              </g>
            );
          })}
          {activeIndex !== null && (
            <line
              className="chart-indicator"
              x1={pad.left + groupW * activeIndex + groupW / 2}
              y1={pad.top}
              x2={pad.left + groupW * activeIndex + groupW / 2}
              y2={pad.top + innerH}
            />
          )}
        </svg>
        {active && activeIndex !== null && (
          <div
            className="chart-tooltip"
            role="tooltip"
            style={{ left: `clamp(100px, ${((pad.left + groupW * activeIndex + groupW / 2) / width) * 100}%, calc(100% - 100px))` }}
          >
            <div className="chart-tooltip-label">{active.label}</div>
            <div className="chart-tooltip-row"><span><i style={{ background: colorA }} />{labels[0]}</span><strong>{fmtNum(active.a)}</strong></div>
            <div className="chart-tooltip-row"><span><i style={{ background: colorB }} />{labels[1]}</span><strong>{fmtNum(active.b)}</strong></div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
