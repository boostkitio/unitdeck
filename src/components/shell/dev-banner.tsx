/**
 * The bar that says the data on screen is not real.
 *
 * Not dismissible on purpose: a safety notice you can close is one you close on
 * the first day and never see again. It costs 28px, and it is the only thing
 * standing between a rehearsal and somebody planning a shoot against it.
 *
 * The colours are literal rather than theme tokens because it has to read as an
 * alarm in both light and dark, which is the one place a themed surface would
 * politely blend in.
 */
export function DevBanner({ deployment }: { deployment: string }) {
  return (
    <div
      role="status"
      className="sticky top-0 z-40 flex h-7 shrink-0 items-center justify-center gap-1.5 bg-red-600 px-4 text-xs font-medium text-white"
    >
      <span>All data currently in dev</span>
      <span aria-hidden className="text-white/60">·</span>
      <span className="font-mono text-white/80">{deployment}</span>
    </div>
  );
}
