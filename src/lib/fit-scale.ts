/**
 * How much to shrink a fixed-width page so it fits the screen showing it.
 *
 * A call sheet is laid out at A4 because it gets printed and handed round on
 * set, and the PDF depends on those millimetres. Reflowing it for a phone
 * would produce a different document. Scaling it produces the same one, just
 * smaller, which is what someone checking a call time actually wants.
 */
export function fitScale(containerWidth: number, pageWidth: number): number {
  // An unmeasured container reports zero. Full size is the safe assumption:
  // scaling by zero would collapse the page to nothing.
  if (!(containerWidth > 0) || !(pageWidth > 0)) return 1;
  // Never magnify — print output and wide screens stay exactly as designed.
  if (containerWidth >= pageWidth) return 1;
  return containerWidth / pageWidth;
}
