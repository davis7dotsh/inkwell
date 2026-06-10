/** Compact unique id for client-created annotations (strokes/boxes/notes). */
export function newId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}
