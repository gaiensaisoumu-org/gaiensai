import { useEffect, useState, useCallback, useRef } from 'preact/hooks';
import { registerSW } from 'virtual:pwa-register';
import styles from '../styles/pwa-update-toast.module.css';

interface PWAUpdateToastProps {
  // Optional: custom selector for textareas/inputs to check for unsaved data
  unsavedInputSelector?: string;
}

export const PWAUpdateToast = ({
  unsavedInputSelector,
}: PWAUpdateToastProps) => {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  // useEffect内で生成された更新関数と、連打防止用のロックを保持する。
  const updateServiceWorkerRef = useRef<
    ((reloadPage?: boolean) => Promise<void>) | null
  >(null);
  const isUpdatingRef = useRef(false);

  // Check if there are unsaved inputs
  const hasUnsavedData = useCallback((): boolean => {
    const selector =
      unsavedInputSelector ||
      'textarea, input[type="text"], input[type="search"]';
    const inputs = document.querySelectorAll(selector);

    for (const input of inputs) {
      const element = input as HTMLInputElement | HTMLTextAreaElement;
      if (element.value && element.value.trim() !== '') {
        return true;
      }
    }
    return false;
  }, [unsavedInputSelector]);

  // Register service worker
  useEffect(() => {
    let cleanupRegistration: (() => void) | undefined;
    const updateServiceWorker = registerSW({
      onNeedRefresh() {
        setNeedRefresh(true);
      },
      onRegistered(registration: ServiceWorkerRegistration | undefined) {
        if (!registration) {
          return;
        }

        // 1. 定期チェック（既存の処理）
        const intervalId = setInterval(
          () => {
            registration.update();
          },
          30 * 60 * 1000,
        );

        // 2. ★ iOS対策: アプリ（画面）に戻ってきたときに強制作動させる
        const handleVisibilityChange = () => {
          if (document.visibilityState === 'visible') {
            registration.update(); // サーバーへ更新がないか見に行く
          }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        cleanupRegistration = () => {
          clearInterval(intervalId);
          document.removeEventListener(
            'visibilitychange',
            handleVisibilityChange,
          );
        };
      },
      onRegisterError(error: Error) {
        // eslint-disable-next-line no-console
        console.error('SW registration error', error);
      },
    });

    updateServiceWorkerRef.current = updateServiceWorker;

    return () => {
      cleanupRegistration?.();
    };
  }, []);

  // skip waiting は vite-plugin-pwa に任せる。ここで location.reload() は行わない。
  const executeUpdate = useCallback(async () => {
    if (isUpdatingRef.current || !updateServiceWorkerRef.current) {
      return;
    }

    isUpdatingRef.current = true;
    setIsUpdating(true);

    try {
      await updateServiceWorkerRef.current(true);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Service worker update error', error);
      isUpdatingRef.current = false;
      setIsUpdating(false);
    }
  }, []);

  // Handle update click with data protection
  const handleUpdate = useCallback(async () => {
    if (hasUnsavedData()) {
      setShowWarning(true);
      return;
    }

    await executeUpdate();
  }, [hasUnsavedData, executeUpdate]);

  // Handle "あとで" click
  const handleDismiss = useCallback(() => {
    setNeedRefresh(false);
    setShowWarning(false);
  }, []);

  // Handle force update from warning dialog
  const handleForceUpdate = useCallback(async () => {
    setShowWarning(false);
    await executeUpdate();
  }, [executeUpdate]);

  if (!needRefresh) {
    return null;
  }

  return (
    <div className={styles.pwaUpdateToast}>
      <div className={styles.pwaUpdateToastContent}>
        <p className={styles.pwaUpdateToastMessage}>
          新しいバージョンが利用可能です
        </p>
        <div className={styles.pwaUpdateToastButtons}>
          <button
            className={`${styles.pwaUpdateToastButton} ${styles.pwaUpdateToastButtonDismiss}`}
            onClick={handleDismiss}
          >
            あとで
          </button>
          <button
            className={`${styles.pwaUpdateToastButton} ${styles.pwaUpdateToastButtonUpdate}`}
            onClick={handleUpdate}
            disabled={isUpdating}
          >
            {isUpdating ? '更新中…' : '更新'}
          </button>
        </div>
      </div>

      {showWarning && (
        <div className={styles.pwaUpdateWarningOverlay}>
          <div className={styles.pwaUpdateWarningDialog}>
            <h3 className={styles.pwaUpdateWarningTitle}>
              未保存のデータがあります
            </h3>
            <p className={styles.pwaUpdateWarningMessage}>
              更新すると、入力中のデータが失われる可能性があります。本当に更新しますか？
            </p>
            <div className={styles.pwaUpdateWarningButtons}>
              <button
                className={`${styles.pwaUpdateWarningButton} ${styles.pwaUpdateWarningButtonCancel}`}
                onClick={() => setShowWarning(false)}
              >
                キャンセル
              </button>
              <button
                className={`${styles.pwaUpdateWarningButton} ${styles.pwaUpdateWarningButtonConfirm}`}
                onClick={handleForceUpdate}
                disabled={isUpdating}
              >
                {isUpdating ? '更新中…' : '更新する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
