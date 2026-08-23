import { supabase } from '../../lib/supabase';

type BootstrapResponse = Awaited<
  ReturnType<typeof supabase.rpc<'get_student_issue_bootstrap'>>
>;
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
      inFlightRequest = Promise.resolve(
        supabase.rpc('get_student_issue_bootstrap'),
      );
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
