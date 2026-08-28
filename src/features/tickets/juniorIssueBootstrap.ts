import { getCachedJuniorIssueBootstrap } from '../cache/appData';

type BootstrapResponse = { data: unknown; error: Error | null };

let inFlightRequest: Promise<BootstrapResponse> | null = null;
let cachedResponse: { value: BootstrapResponse; expiresAt: number } | null =
  null;

export const getJuniorIssueBootstrap = async (): Promise<BootstrapResponse> => {
  if (cachedResponse && cachedResponse.expiresAt > Date.now()) {
    return cachedResponse.value;
  }
  if (!inFlightRequest) {
    inFlightRequest = getCachedJuniorIssueBootstrap()
      .then((response) => ({ data: response.data, error: null }))
      .catch((error) => ({
        data: null,
        error:
          error instanceof Error
            ? error
            : new Error('Junior issue bootstrap request failed'),
      }));
    void inFlightRequest.finally(() => {
      inFlightRequest = null;
    });
  }
  const response = await inFlightRequest;
  if (!response.error) {
    cachedResponse = { value: response, expiresAt: Date.now() + 30_000 };
  }
  return response;
};
