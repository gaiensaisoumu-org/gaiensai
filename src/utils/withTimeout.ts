export class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

export const withTimeout = async <T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
): Promise<T> => {
  let timeoutId: number | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(
      () => reject(new TimeoutError(timeoutMs)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
};
