"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { prefersReducedMotion } from "@/lib/motion";

// One-time count-up animation for stat numbers. A provider watches its own
// container with an IntersectionObserver and flips to "active" the first time
// it scrolls into view; every AnimatedNumber inside then counts from zero to
// its value. When prefers-reduced-motion is set (or before hydration), numbers
// render at their final value with no animation.
//
// A caller that already knows when its numbers become visible (the year recap,
// whose slides are all mounted and toggled by opacity, so scrolling into view
// says nothing) passes `active` and the observer is skipped entirely.

const CountUpContext = createContext<boolean>(true);

export function CountUpGroup({
  children,
  className,
  active: controlled,
}: {
  children: ReactNode;
  className?: string;
  /** Drive activation directly instead of watching for scroll-into-view. */
  active?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Without IntersectionObserver there is no visibility signal, so the group
  // starts active and numbers simply render at their final values.
  const [active, setActive] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    const el = ref.current;
    if (controlled !== undefined) return;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setActive(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [controlled]);

  return (
    <div ref={ref} className={className}>
      <CountUpContext.Provider value={controlled ?? active}>
        {children}
      </CountUpContext.Provider>
    </div>
  );
}

const DURATION_MS = 900;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

interface AnimatedNumberProps {
  value: number;
  /** Decimal places to render (default 0). */
  decimals?: number;
  className?: string;
}

// Renders the value immediately on the server (so the page never shows a bare
// zero without JavaScript), then counts up once the group becomes visible.
export function AnimatedNumber({
  value,
  decimals = 0,
  className,
}: AnimatedNumberProps) {
  const active = useContext(CountUpContext);
  const [display, setDisplay] = useState(value);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!active || startedRef.current) return;
    startedRef.current = true;
    // Reduced motion (or nothing to count): display already holds the final
    // value from its initializer, so there is nothing to animate.
    if (prefersReducedMotion() || value === 0) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      setDisplay(value * easeOutCubic(t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, value]);

  const shown = active ? display : value;
  return (
    <span className={className}>
      {shown.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
    </span>
  );
}
