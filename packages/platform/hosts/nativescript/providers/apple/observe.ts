/** Observes a notification on the main queue until the returned function is called. */
export function observe(name: string, handler: () => void): () => void {
  const center = NSNotificationCenter.defaultCenter;
  const token = center.addObserverForNameObjectQueueUsingBlock(
    name,
    null,
    NSOperationQueue.mainQueue,
    handler,
  );
  return () => center.removeObserver(token);
}
