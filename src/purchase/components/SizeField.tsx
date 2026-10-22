import { useState } from 'react';

export const SIZE_UNITS = ['mm', 'cm', 'm', 'inch', 'ft'];

const UNIT_END = /^(.*?)\s*(mm|cm|m|inch|in|ft)$/i;

/** "50 mm" → { num: '50', unit: 'mm' }; a size with no unit at the end keeps its text and has no unit. */
export function splitSize(v: string): { num: string; unit: string | null } {
  const m = UNIT_END.exec(v.trim());
  if (!m) return { num: v, unit: null };
  const u = m[2].toLowerCase();
  return { num: m[1], unit: u === 'in' ? 'inch' : u };
}

/** Size as one text value ("Ø50 mm") with a unit dropdown beside it; the value stays a plain string for the database. */
export function SizeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parsed = splitSize(value || '');
  const [picked, setPicked] = useState('mm');
  const unit = parsed.unit ?? picked;
  const join = (num: string, u: string) => (num.trim() ? `${num.trim()} ${u}` : '');
  return (
    <div className="size-field" style={{ width: `calc(${Math.max(parsed.num.length, 3)}ch + 84px)` }}>
      <input
        type="text"
        value={parsed.num}
        onChange={(e) => onChange(join(e.target.value, unit))}
      />
      <span className="unit">{unit} ▾</span>
      <select
        value={unit}
        onChange={(e) => {
          setPicked(e.target.value);
          onChange(join(parsed.num, e.target.value));
        }}
        aria-label="Size unit"
      >
        {SIZE_UNITS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
    </div>
  );
}
