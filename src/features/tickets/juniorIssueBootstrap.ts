import { supabase } from '../../lib/supabase';

type BootstrapResponse = Awaited<
  ReturnType<typeof supabase.rpc<'get_junior_issue_bootstrap'>>
>;

let inFlightRequest: Promise<BootstrapResponse> | null = null;
let cachedResponse: { value: BootstrapResponse; expiresAt: number } | null =
  null;

export const getJuniorIssueBootstrap = async (): Promise<BootstrapResponse> => {
  if (cachedResponse && cachedResponse.expiresAt > Date.now()) {
    return cachedResponse.value;
  }
  if (!inFlightRequest) {
    inFlightRequest = Promise.resolve(
      supabase.rpc('get_junior_issue_bootstrap'),
    );
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
