export class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

export class OfflineError extends Error {
  constructor() {
    super('Network connection is offline');
    this.name = 'OfflineError';
  }
}

export const withTimeout = async <T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  rejectWhenOffline = false,
): Promise<T> => {
  let timeoutId: number | undefined;
  let removeOfflineListener: (() => void) | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(
      () => reject(new TimeoutError(timeoutMs)),
      timeoutMs,
    );
  });

  const offline = rejectWhenOffline
    ? new Promise<never>((_, reject) => {
        const rejectOffline = () => reject(new OfflineError());
        if (!navigator.onLine) {
          rejectOffline();
          return;
        }
        window.addEventListener('offline', rejectOffline, { once: true });
        removeOfflineListener = () =>
          window.removeEventListener('offline', rejectOffline);
      })
    : null;

  try {
    return await Promise.race([
      Promise.resolve(promise),
      timeout,
      ...(offline ? [offline] : []),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
    removeOfflineListener?.();
  }
};
