import { supabase } from '../../lib/supabase';

type AvailabilityResponse = Awaited<
  ReturnType<typeof supabase.rpc<'get_performance_availability'>>
>;
let inFlightRequest: Promise<AvailabilityResponse> | null = null;

let cachedResponse: { value: AvailabilityResponse; expiresAt: number } | null =
  null;
const CACHE_TTL_MS = 30_000;

export const getPerformanceAvailability =
  async (): Promise<AvailabilityResponse> => {
    if (cachedResponse && cachedResponse.expiresAt > Date.now()) {
      return cachedResponse.value;
    }

    if (!inFlightRequest) {
      inFlightRequest = Promise.resolve(
        supabase.rpc('get_performance_availability'),
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
