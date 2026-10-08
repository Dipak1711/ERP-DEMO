import { useEffect, useRef, useState } from 'react';
import { fmtNum } from './format';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Counts a number up to `target` so its value arriving (and later changing) is
 * visible, not just stated. The number carries the meaning; the movement only
 * points at it. Falls back to an instant set when motion is reduced.
 */
export function useCountUp(target: number) {
  const [display, setDisplay] = useState(() => (prefersReducedMotion() ? target : 0));
  const shown = useRef(display);

  useEffect(() => {
    if (prefersReducedMotion() || !Number.isFinite(target)) {
      shown.current = target;
      setDisplay(target);
      return;
    }
    if (target === shown.current) return;
    const from = shown.current;
    const start = performance.now();
    const ms = Math.min(900, 260 + Math.abs(target - from) * 6);
    let id = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 4);
      const next = t < 1 ? Math.round(from + (target - from) * eased) : target;
      shown.current = next;
      setDisplay(next);
      if (t < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [target]);

  return display;
}

/** A number that counts up to its value. */
export function AnimatedNum({ value }: { value: number }) {
  return <>{fmtNum(useCountUp(value))}</>;
}
