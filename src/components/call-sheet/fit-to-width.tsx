"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fitScale } from "@/lib/fit-scale";

/** A4 at 96dpi. The call sheet is laid out at 210mm and this is that in pixels. */
const A4_WIDTH_PX = 794;

/**
 * Shrinks a fixed-width page to fit the screen it is being read on.
 *
 * The call sheet is an A4 document, so on a phone it used to sit at roughly
 * twice the viewport width and drag the whole page sideways. Scaling keeps it
 * the same document — the thing that gets printed and signed — while making it
 * readable on the device someone actually has on set.
 *
 * Printing is untouched: the transform is removed in print, so the sheet goes
 * to paper at full size.
 */
export function FitToWidth({ children }: { children: React.ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pageHeight, setPageHeight] = useState(0);

  const measure = useCallback(() => {
    if (frame.current) setScale(fitScale(frame.current.clientWidth, A4_WIDTH_PX));
    // offsetHeight is the unscaled height: a transform does not change layout.
    if (page.current) setPageHeight(page.current.offsetHeight);
  }, []);

  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (frame.current) observer.observe(frame.current);
    if (page.current) observer.observe(page.current);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div
      ref={frame}
      className="w-full print:!h-auto"
      // A scaled element still occupies its original height, which would leave
      // a long empty tail under the sheet. Reserving the scaled height instead
      // keeps the page as short as it looks.
      style={scale < 1 && pageHeight > 0 ? { height: pageHeight * scale } : undefined}
    >
      <div ref={page} className="w-fit origin-top-left print:!scale-100" style={{ transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}
