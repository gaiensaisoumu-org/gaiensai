import { getCachedStudentIssueBootstrap } from '../cache/appData';

type BootstrapResponse = { data: unknown; error: Error | null };
let inFlightRequest: Promise<BootstrapResponse> | null = null;

let cachedResponse: { value: BootstrapResponse; expiresAt: number } | null =
  null;
const CACHE_TTL_MS = 30_000;

export const getStudentIssueBootstrap =
  async (): Promise<BootstrapResponse> => {
    if (cachedResponse && cachedResponse.expiresAt > Date.now()) {
      return cachedResponse.value;
    }

    if (!inFlightRequest) {
      inFlightRequest = getCachedStudentIssueBootstrap()
        .then((response) => ({ data: response.data, error: null }))
        .catch((error) => ({
          data: null,
          error:
            error instanceof Error
              ? error
              : new Error('Student issue bootstrap request failed'),
        }));
      void inFlightRequest.finally(() => {
        inFlightRequest = null;
      });
    }

    const response = await inFlightRequest;
    if (!response.error) {
      cachedResponse = {
        value: response,
        expiresAt: Date.now() + CACHE_TTL_MS,
      };
    }
    return response;
  };
