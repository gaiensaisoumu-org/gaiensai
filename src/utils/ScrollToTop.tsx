import { useEffect } from 'preact/hooks';
import { useLocation } from 'preact-iso';

export const PERFORMANCE_LIST_SCROLL_POSITION_KEY =
  'performances-list-scroll-position';
export const RESTORE_PERFORMANCE_LIST_SCROLL_KEY =
  'restore-performances-list-scroll';

export const savePerformanceListScrollPosition = () => {
  sessionStorage.setItem(
    PERFORMANCE_LIST_SCROLL_POSITION_KEY,
    String(window.scrollY),
  );
  sessionStorage.setItem(RESTORE_PERFORMANCE_LIST_SCROLL_KEY, 'true');
};

export const ScrollToTop = () => {
  const { path } = useLocation();

  useEffect(() => {
    const shouldRestorePerformanceList =
      path === '/performances' &&
      sessionStorage.getItem(RESTORE_PERFORMANCE_LIST_SCROLL_KEY) === 'true';
    if (shouldRestorePerformanceList) {
      sessionStorage.removeItem(RESTORE_PERFORMANCE_LIST_SCROLL_KEY);
      const storedPosition = Number(
        sessionStorage.getItem(PERFORMANCE_LIST_SCROLL_POSITION_KEY),
      );
      const animationFrame = window.requestAnimationFrame(() => {
        window.scrollTo({
          top: Number.isFinite(storedPosition) ? storedPosition : 0,
          left: 0,
          behavior: 'auto',
        });
      });
      return () => window.cancelAnimationFrame(animationFrame);
    }
    if (!path.startsWith('/performances/')) {
      sessionStorage.removeItem(RESTORE_PERFORMANCE_LIST_SCROLL_KEY);
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [path]);

  return null;
};
