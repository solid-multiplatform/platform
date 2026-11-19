// The runtime's events, handed on by type. The runtime calls once per turn
// of its loop in which something happened, with everything that did; nothing
// here runs otherwise, and nothing is registered with the runtime until the
// first subscription.
type EventType = SolidInputEvent['type'];
type Handler = (event: SolidInputEvent) => void;

const handlers = new Map<EventType, readonly Handler[]>();
let listening = false;

function deliver(events: SolidInputEvent[], count: number): void {
  for (let i = 0; i < count; i++) {
    const event = events[i]!;
    // The list is replaced, never changed, when a handler comes or goes, so
    // a handler may unsubscribe while its event is being delivered.
    const list = handlers.get(event.type);
    if (list === undefined) continue;
    for (let h = 0; h < list.length; h++) {
      try {
        list[h]!(event);
      } catch (error) {
        // One handler's failure must not cost the others the event.
        console.error(`Uncaught in a ${event.type} handler:`, error);
      }
    }
  }
  // The array is the runtime's and is reused: its events are not kept.
  events.length = 0;
}

/**
 * Calls `handler` for every event of `type` until the returned function is
 * called. Handlers run in the order they subscribed. Throws in a run without
 * a window, which has no input.
 */
export function onNative(type: EventType, handler: Handler): () => void {
  const input = __solid.input;
  if (input === undefined) {
    throw new Error('The desktop host needs a window: run without --headless');
  }
  if (!listening) {
    input.listen(deliver);
    listening = true;
  }
  handlers.set(type, [...(handlers.get(type) ?? []), handler]);
  return () => {
    const rest = (handlers.get(type) ?? []).filter((h) => h !== handler);
    if (rest.length === 0) handlers.delete(type);
    else handlers.set(type, rest);
  };
}
