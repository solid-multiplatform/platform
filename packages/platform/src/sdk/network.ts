export function createNetwork(request: typeof fetch) {
  return async function send(
    input: RequestInfo | URL,
    init: RequestInit & { timeoutMs?: number } = {},
  ) {
    const { timeoutMs = 30000, signal, ...options } = init;
    const abort = new AbortController();
    const cancel = () => abort.abort(signal?.reason);
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(
      () => abort.abort(new Error('Request deadline exceeded')),
      timeoutMs,
    );
    try {
      return await request(input, { ...options, signal: abort.signal });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  };
}
