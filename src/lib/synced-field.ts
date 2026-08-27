/**
 * Reconciling a field you are typing in with the same field somebody else is
 * typing in.
 *
 * The old rule was "save whenever the local value differs from the stored
 * one". With two people in a project that is a loop: their save changes the
 * stored value, which now differs from my untouched local copy, so my copy is
 * written back over theirs — and their browser does the same to mine. Neither
 * edit survives, which reads as the project not saving at all.
 *
 * The fix is to distinguish "I have typed something that is not saved yet"
 * from "this simply differs from what I last saw". A draft is only ever
 * created by typing, so a field nobody is editing has none and can adopt
 * whatever arrives.
 */

/** What the field shows: your own unsaved text, or the stored value. */
export function fieldValue(draft: string | null, savedValue: string): string {
  return draft ?? savedValue;
}

/**
 * Whether there is an edit to write.
 *
 * No draft means nothing has been typed, so an incoming change is somebody
 * else's and is adopted rather than fought.
 *
 * `canSave` rejects a value the server would refuse — a blank name, say — so
 * that half-typed states do not fire a doomed request per keystroke. The
 * field still shows what was typed; it just is not sent yet.
 */
export function shouldSave(
  draft: string | null,
  savedValue: string,
  canSave: (value: string) => boolean = () => true,
): boolean {
  return draft !== null && draft !== savedValue && canSave(draft);
}

/**
 * Whether the draft can be dropped and the stored value trusted again.
 *
 * Checked against the value that was actually written: if more has been typed
 * while the save was in flight, that is still unsaved and holding it is the
 * whole point. Letting go otherwise is what puts the field back in step with
 * everyone else in the project.
 */
export function shouldSettle(draft: string | null, savedValue: string): boolean {
  return draft !== null && draft === savedValue;
}
