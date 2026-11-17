'use client';

// charts in plain svg, following the dataviz method: thin marks with 4px rounded data ends,
// a 2px surface gap, hairline grid, text in ink tokens, a hover and focus tooltip on every mark,
// and a table view for every chart. colors validated with the dataviz validator:
//   single series  light #B0234F, dark #E04A74
//   ordinal funnel light #E68BA5 / #C8456C / #8E1A3F, dark #8C3053 / #C2486F / #F49AB3

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Segmented } from '@/components/ui/kit';
import { useT } from '@/lib/i18n-client';

const H_BAR = 20; // bar thickness, capped under 24
const GAP = 2;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * exp;
}

// a column path: square at the baseline, 4px rounded at the data end
function vbar(x: number, base: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h / 2);
  if (h <= 0) return '';
  const top = base - h;
  return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`;
}

export function ChartCard({ title, subtitle, children, table, legend }: { title: string; subtitle?: ReactNode; children: ReactNode; table: ReactNode; legend?: ReactNode }) {
  const t = useT();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <section className="card p-4 md:p-5 mb-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h2 className="t-headline m-0">{title}</h2>
          {subtitle ? <p className="t-foot t-2 m-0 mt-0.5">{subtitle}</p> : null}
        </div>
        <Segmented label={t('reports.view')} value={view} onChange={setView} options={[{ value: 'chart', label: t('reports.chart') }, { value: 'table', label: t('reports.table') }]} />
      </div>
      {legend && view === 'chart' ? <div className="mb-2">{legend}</div> : null}
      {view === 'chart' ? children : <div className="overflow-x-auto">{table}</div>}
    </section>
  );
}

function Tooltip({ x, y, value, label }: { x: string; y: string; value: string; label: string }) {
  return (
    <div role="tooltip" className="absolute pointer-events-none z-10 px-2.5 py-1.5 rounded-[8px] t-foot"
      style={{ left: x, top: y, transform: 'translate(-50%, calc(-100% - 8px))', background: 'var(--c-elevated)', color: 'var(--c-ink)', boxShadow: '0 4px 16px rgba(0,0,0,0.14), 0 0 0 0.5px var(--c-line)', whiteSpace: 'nowrap' }}>
      <span className="block t-sub tnum" style={{ fontWeight: 600 }}>{value}</span>
      <span className="block t-2">{label}</span>
    </div>
  );
}

// -------------------------------------------------------------- columns over time, one series

// the svg is drawn at the real pixel width, so text stays at 11px on every screen
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function ColumnChart({ data, format, formatAxis, label }: { data: { key: string; label: string; long: string; value: number }[]; format: (n: number) => string; formatAxis: (n: number) => string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, W] = useWidth<HTMLDivElement>();
  const Hh = 220, left = 52, right = 8, top = 16, bottom = 28;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const plotW = W - left - right, plotH = Hh - top - bottom;
  const slot = plotW / Math.max(1, data.length);
  const bw = Math.min(24, slot - GAP * 2 - 6);
  const ticks = [0, max / 2, max];
  const maxIdx = data.reduce((m, d, i) => (d.value > (data[m]?.value ?? -1) ? i : m), 0);
  const y = (v: number) => top + plotH - (v / max) * plotH;

  return (
    <div ref={box} className="relative" onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${Hh}`} width={W} height={Hh} role="img" aria-label={label} style={{ display: 'block', overflow: 'visible' }}>
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={left} x2={W - right} y1={y(tk)} y2={y(tk)} stroke="var(--c-line)" strokeWidth={1} />
            <text x={left - 8} y={y(tk)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--c-ink-2)" className="tnum">{formatAxis(tk)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = left + i * slot + (slot - bw) / 2;
          const h = (d.value / max) * plotH;
          const showLabel = i === maxIdx || i === data.length - 1;
          return (
            <g key={d.key}>
              <rect x={left + i * slot} y={top} width={slot} height={plotH} fill="transparent"
                tabIndex={0} aria-label={`${d.long}: ${format(d.value)}`}
                onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} style={{ outline: 'none', cursor: 'default' }} />
              <path d={vbar(x, top + plotH, bw, h)} fill="var(--chart-1)" opacity={hover == null || hover === i ? 1 : 0.55} style={{ transition: 'opacity 120ms' }} pointerEvents="none" />
              {showLabel ? <text x={x + bw / 2} y={top + plotH - h - 6} textAnchor="middle" fontSize={11} fill="var(--c-ink)" className="tnum" fontWeight={600} pointerEvents="none">{formatAxis(d.value)}</text> : null}
              {(W < 480 ? i % 2 === (data.length - 1) % 2 : true) ? <text x={x + bw / 2} y={Hh - 8} textAnchor="middle" fontSize={11} fill="var(--c-ink-2)" pointerEvents="none">{d.label}</text> : null}
            </g>
          );
        })}
        <line x1={left} x2={W - right} y1={top + plotH} y2={top + plotH} stroke="var(--c-ink-3)" strokeWidth={1} />
      </svg>
      {hover != null && data[hover] ? (
        <Tooltip x={`${((left + hover * slot + slot / 2) / W) * 100}%`} y={`${(y(data[hover].value) / Hh) * 100}%`} value={format(data[hover].value)} label={data[hover].long} />
      ) : null}
    </div>
  );
}

// -------------------------------------------------------------- horizontal bars, one series

export function BarList({ data, format, label, empty }: { data: { key: string; label: string; value: number; note?: string }[]; format: (n: number) => string; label: string; empty?: string }) {
  const id = useId();
  const max = Math.max(...data.map((d) => d.value), 1);
  if (!data.length) return <p className="t-sub t-2 m-0 py-6 text-center">{empty}</p>;
  return (
    <ul className="list-none p-0 m-0 flex flex-col gap-3" aria-label={label}>
      {data.map((d) => {
        const pct = Math.max(0.02, d.value / max);
        return (
          <li key={d.key} className="group/bar" tabIndex={0} aria-label={`${d.label}: ${format(d.value)}`} aria-describedby={d.note ? `${id}-${d.key}` : undefined}>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="t-sub flex-1 min-w-0 truncate">{d.label}</span>
              {d.note ? <span id={`${id}-${d.key}`} className="t-foot t-2">{d.note}</span> : null}
            </div>
            <div className="flex items-center gap-2">
              <span className="flex-1" aria-hidden="true">
                <span className="block transition-opacity group-hover/bar:opacity-80 group-focus/bar:opacity-80" style={{ width: `${pct * 100}%`, height: H_BAR, background: 'var(--chart-1)', borderRadius: '0 4px 4px 0' }} />
              </span>
              <span className="t-sub tnum text-right" style={{ minWidth: 64, fontWeight: 600 }}>{format(d.value)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// -------------------------------------------------------------- funnel per join link, ordinal stages

export function FunnelBars({ data, stages, format, label }: { data: { key: string; label: string; values: number[] }[]; stages: string[]; format: (n: number) => string; label: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = useMemo(() => Math.max(1, ...data.flatMap((d) => d.values)), [data]);
  return (
    <ul className="list-none p-0 m-0 flex flex-col gap-5" aria-label={label}>
      {data.map((d) => {
        const conv = d.values[0] ? d.values[d.values.length - 1]! / d.values[0] : 0;
        return (
          <li key={d.key}>
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="t-sub flex-1 min-w-0 truncate" style={{ fontWeight: 600 }}>{d.label}</span>
              <span className="t-foot t-2 tnum">{Math.round(conv * 100)}%</span>
            </div>
            <div className="flex flex-col" style={{ gap: GAP }}>
              {d.values.map((v, i) => {
                const k = `${d.key}:${i}`;
                return (
                  <div key={k} className="relative flex items-center gap-2" tabIndex={0} aria-label={`${d.label}, ${stages[i]}: ${format(v)}`}
                    onPointerEnter={() => setHover(k)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(k)} onBlur={() => setHover(null)} style={{ outline: 'none' }}>
                    <span className="flex-1" aria-hidden="true">
                      <span className="block transition-opacity" style={{ width: `${Math.max(0.6, (v / max) * 100)}%`, height: H_BAR - 6, background: `var(--ord-${i + 1})`, borderRadius: '0 4px 4px 0', opacity: hover == null || hover === k ? 1 : 0.6 }} />
                    </span>
                    <span className="t-foot tnum text-right" style={{ minWidth: 56, color: hover === k ? 'var(--c-ink)' : 'var(--c-ink-2)' }}>{format(v)}</span>
                    {hover === k ? <span className="sr-only">{stages[i]}</span> : null}
                  </div>
                );
              })}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex gap-4 flex-wrap t-foot t-2">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: i.color, display: 'inline-block' }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full t-sub" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr>{head.map((h, i) => <th key={h} className="t-foot t-2 py-2 px-2" style={{ textAlign: i === 0 ? 'left' : 'right', fontWeight: 500, borderBottom: '0.5px solid var(--c-line)' }}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j} className={`py-2 px-2 ${j ? 'tnum' : ''}`} style={{ textAlign: j === 0 ? 'left' : 'right', borderBottom: '0.5px solid var(--c-line)' }}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}
