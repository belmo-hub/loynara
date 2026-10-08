/** Independent of the claim loop; a stalled monitor fails closed and cannot spawn overlapping checks. */
export function startWorkerMonitor(options: { heartbeat: (signal: AbortSignal) => Promise<void>; onFailure?: () => void; intervalMs?: number; timeoutMs?: number }): () => Promise<void> {
  let stopped = false;
  let next: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;
  let cancel: (() => void) | undefined;
  const tick = () => {
    if (stopped) return;
    active = new Promise<void>(resolve => {
      let finished = false;
      const controller = new AbortController();
      const done = (failed: boolean) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        controller.abort();
        if (failed) { stopped = true; options.onFailure?.(); }
        resolve();
        if (!stopped) next = setTimeout(tick, options.intervalMs ?? 60_000);
      };
      const timeout = setTimeout(() => done(true), options.timeoutMs ?? 12_000);
      cancel = () => done(false);
      Promise.resolve().then(() => options.heartbeat(controller.signal)).then(() => done(false), () => done(true));
    });
  };
  tick();
  return async () => {
    stopped = true;
    if (next) clearTimeout(next);
    cancel?.();
    await active;
  };
}
