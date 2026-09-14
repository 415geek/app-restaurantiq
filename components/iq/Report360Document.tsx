'use client';

/**
 * On-screen frame for the 360° document (the same `.page` boxes the PDF uses).
 *
 * The document is a fixed-width block (203.9 mm ≈ 771 px, print.css). Below
 * that width the whole block is scaled with `transform: scale(k)` from the
 * top-left corner so it fits the container (phones, tablets) — the layout
 * stays identical to the PDF and pinch-zoom still works. At ≥ the natural
 * width k = 1 and the block is centred. Server render is unscaled; the
 * transform is applied after mount (no hydration mismatch) and tracked with
 * a ResizeObserver.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export function Report360Document({ children }: { children: ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const available = outer.clientWidth;
      const natural = inner.offsetWidth;
      if (!available || !natural) return;
      const scale = available >= natural ? 1 : available / natural;
      setFit((prev) => {
        const height = Math.ceil(inner.offsetHeight * scale);
        return prev && prev.scale === scale && prev.height === height ? prev : { scale, height };
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  const scaled = fit != null && fit.scale < 1;
  const outerStyle: CSSProperties | undefined = scaled ? { height: fit.height, overflow: 'hidden' } : undefined;
  const innerStyle: CSSProperties = scaled
    ? { width: 'max-content', transform: `scale(${fit.scale})`, transformOrigin: 'top left' }
    : { width: 'max-content', marginInline: 'auto' };

  return (
    <div ref={outerRef} className="report-viewer-scale w-full" style={outerStyle} data-scale={fit?.scale.toFixed(3) ?? '1'}>
      <div ref={innerRef} className="report-viewer-inner" style={innerStyle}>
        {children}
      </div>
    </div>
  );
}
