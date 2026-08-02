import { useEffect } from 'preact/hooks';
import { clearTicketDisplayCacheBefore } from './ticketDisplayCache';

const CLEANUP_THRESHOLD = 1785650825682;
const EXPIRATION_PERIOD_MS = 45 * 24 * 60 * 60 * 1000; // 1ヶ月半 (45日間)

export const useTicketCleanup = () => {
  useEffect(() => {
    const now = Date.now();
    const expirationThreshold = now - EXPIRATION_PERIOD_MS;

    // 特定の閾値、または1ヶ月以上経過した古いキャッシュをクリーンアップする
    clearTicketDisplayCacheBefore(
      Math.max(CLEANUP_THRESHOLD, expirationThreshold),
    );
  }, []);
};
