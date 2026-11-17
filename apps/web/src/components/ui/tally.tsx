'use client';

// the signature: stock numbers roll like a mechanical tally counter when they change.
// screen readers get the plain number, reduced motion gets no roll (css handles it).

import { useEffect, useRef, useState } from 'react';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function Tally({ value, format, className }: { value: number; format?: (n: number) => string; className?: string }) {
  const text = format ? format(value) : String(value);
  const [shown, setShown] = useState(text);
  const first = useRef(true);

  useEffect(() => {
    // first paint shows the number as is, later changes roll
    if (first.current) { first.current = false; setShown(text); return; }
    const id = requestAnimationFrame(() => setShown(text));
    return () => cancelAnimationFrame(id);
  }, [text]);

  return (
    <span className={`tally ${className ?? ''}`} aria-label={text} role="text">
      {shown.split('').map((ch, i) => {
        const d = DIGITS.indexOf(ch);
        if (d < 0) return <span key={`s${i}`} aria-hidden="true">{ch}</span>;
        return (
          <span key={`d${shown.length - i}`} className="tally-digit" aria-hidden="true">
            <span className="tally-strip" style={{ transform: `translateY(-${d * 1.25}em)` }}>
              {DIGITS.map((x) => <span key={x}>{x}</span>)}
            </span>
          </span>
        );
      })}
    </span>
  );
}
