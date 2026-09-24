import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

export type SortDirection = 'asc' | 'desc';
export type SortValue = string | number | null | undefined;

export function useTableSort<Key extends string>(initialKey: Key, initialDirection: SortDirection = 'asc') {
  const [key, setKey] = useState<Key>(initialKey);
  const [direction, setDirection] = useState<SortDirection>(initialDirection);
  function toggle(nextKey: Key) {
    if (nextKey === key) setDirection((current) => current === 'asc' ? 'desc' : 'asc');
    else { setKey(nextKey); setDirection('asc'); }
  }
  return { key, direction, toggle };
}

export function sortRows<Row>(rows: readonly Row[], key: string, direction: SortDirection, value: (row: Row, key: string) => SortValue): Row[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...rows].sort((a, b) => {
    const left = value(a, key);
    const right = value(b, key);
    if (left == null || left === '') return right == null || right === '' ? 0 : 1;
    if (right == null || right === '') return -1;
    const result = typeof left === 'number' && typeof right === 'number'
      ? left - right : collator.compare(String(left), String(right));
    return direction === 'asc' ? result : -result;
  });
}

export function SortTh<Key extends string>({ label, column, sort, numeric, className, title }: {
  label: ReactNode; column: Key;
  sort: { key: Key; direction: SortDirection; toggle: (key: Key) => void };
  numeric?: boolean; className?: string; title?: string;
}) {
  const active = sort.key === column;
  const Icon = active ? sort.direction === 'asc' ? ArrowUp : ArrowDown : ArrowUpDown;
  return <th className={[numeric ? 'num' : '', className || ''].filter(Boolean).join(' ')}
    aria-sort={active ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'} title={title}>
    <button className={`table-sort ${numeric ? 'numeric' : ''}`} type="button" onClick={() => sort.toggle(column)}>
      <span>{label}</span><Icon size={14} aria-hidden="true" />
    </button>
  </th>;
}
