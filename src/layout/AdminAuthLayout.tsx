import { createContext, type ComponentChildren } from 'preact';
import { useEffect, useState, useContext } from 'preact/hooks';
import { supabase } from '../lib/supabase';
import styles from '../pages/admin/Settings.module.css';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import NormalSection from '../components/ui/NormalSection';
import BackButton from '../components/ui/BackButton';

export const ADMIN_CONTROL_PANEL_SESSION_TOKEN_KEY =
  'admin_control_panel_session_v2';

export const getSessionToken = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const token = window.localStorage.getItem(
    ADMIN_CONTROL_PANEL_SESSION_TOKEN_KEY,
  );
  return token && token.trim().length > 0 ? token : null;
};

export const saveSessionToken = (token: string) => {
  window.localStorage.setItem(ADMIN_CONTROL_PANEL_SESSION_TOKEN_KEY, token);
};

export const clearSessionToken = () => {
  window.localStorage.removeItem(ADMIN_CONTROL_PANEL_SESSION_TOKEN_KEY);
};

export const readErrorMessage = async (error: unknown): Promise<string> => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    !error.message.includes('non-2xx')
  ) {
    return error.message;
  }

  try {
    const responseMessage = (await (
      error as { context: { json: () => Promise<unknown> } }
    ).context.json()) as { error?: string };
    if (responseMessage?.error) {
      return responseMessage.error;
    }
  } catch {
    // no-op
  }

  return '通信状況と設定を確認してください。';
};

interface AdminAuthContextType {
  lock: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextType | undefined>(
  undefined,
);

export const useAdminAuth = () => {
  const context = useContext(AdminAuthContext);
  if (!context) {
    throw new Error('useAdminAuth must be used within an AdminAuthLayout');
  }
  return context;
};

interface AdminAuthLayoutProps {
  children: ComponentChildren;
  title: string;
  description?: string;
  onBack?: () => void;
}

export const AdminAuthLayout = ({
  children,
  title,
  description,
  onBack,
}: AdminAuthLayoutProps) => {
  const [password, setPassword] = useState('');
  const [authState, setAuthState] = useState<
    'checking' | 'locked' | 'unlocked'
  >('checking');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loginWarningMessage, setLoginWarningMessage] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let isActive = true;

    const verifySession = async () => {
      const token = getSessionToken();
      if (!token) {
        if (isActive) {
          setAuthState('locked');
        }
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke('admin-auth', {
          body: { action: 'verify' },
          headers: {
            'x-admin-session-token': token,
          },
        });

        if (error) {
          throw error;
        }

        if (isActive) {
          setAuthState(data?.authenticated ? 'unlocked' : 'locked');
        }

        if (!data?.authenticated) {
          clearSessionToken();
        }
      } catch {
        clearSessionToken();
        if (isActive) {
          setAuthState('locked');
        }
      }
    };

    void verifySession();

    return () => {
      isActive = false;
    };
  }, []);

  const handleUnlock = async (event: Event) => {
    event.preventDefault();
    setErrorMessage(null);
    setLoginWarningMessage(null);
    setIsSubmitting(true);

    try {
      const { data, error } = await supabase.functions.invoke('admin-auth', {
        body: { action: 'login', password },
      });

      if (error) {
        throw error;
      }

      if (!data?.authenticated) {
        setErrorMessage('パスワードが正しくありません。');
        const remainingAttempts =
          typeof data?.remainingAttempts === 'number'
            ? data.remainingAttempts
            : null;
        if (
          remainingAttempts !== null &&
          remainingAttempts >= 1 &&
          remainingAttempts <= 3
        ) {
          setLoginWarningMessage(
            `あと${remainingAttempts}回間違えると一定時間ロックされます。`,
          );
        }
        return;
      }

      if (
        typeof data?.sessionToken !== 'string' ||
        data.sessionToken.length < 1
      ) {
        setErrorMessage('セッション作成に失敗しました。');
        return;
      }

      saveSessionToken(data.sessionToken);
      setPassword('');
      setLoginWarningMessage(null);
      setAuthState('unlocked');
    } catch (error) {
      const message = await readErrorMessage(error);
      setErrorMessage(`認証に失敗しました。${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const lock = async () => {
    const token = getSessionToken();
    if (token) {
      try {
        await supabase.functions.invoke('admin-auth', {
          body: { action: 'logout' },
          headers: {
            'x-admin-session-token': token,
          },
        });
      } catch {
        // no-op
      }
    }

    clearSessionToken();
    setAuthState('locked');
    setPassword('');
    setErrorMessage(null);
    setLoginWarningMessage(null);
  };

  if (authState === 'checking') {
    return (
      <div className={styles.authContainer}>
        <h1 className={styles.pageTitle}>{title}</h1>
        <LoadingSpinner message='認証状態を確認しています...' />
      </div>
    );
  }

  if (authState === 'locked') {
    return (
      <div>
        <h1 className={styles.pageTitle}>{title}</h1>
        <NormalSection className={styles.authForm}>
          <h2>管理者ログイン</h2>
          <form className={styles.authLoginForm} onSubmit={handleUnlock}>
            <input
              type='text'
              name='username'
              value='admin'
              autocomplete='username'
              style='display: none;'
              aria-hidden='true'
            />
            <label
              className={styles.authLabel}
              htmlFor='admin-control-password'
            >
              管理者パスワード
            </label>
            <input
              id='admin-control-password'
              type='password'
              className={styles.authInput}
              value={password}
              onInput={(event) =>
                setPassword((event.target as HTMLInputElement).value)
              }
              autoComplete='current-password'
              required
            />
            {errorMessage && <p className={styles.authError}>{errorMessage}</p>}
            {loginWarningMessage && (
              <p className={styles.authWarning}>{loginWarningMessage}</p>
            )}
            <button
              type='submit'
              className={styles.authButton}
              disabled={isSubmitting}
            >
              {isSubmitting ? '認証中...' : 'ログイン'}
            </button>
          </form>
        </NormalSection>
      </div>
    );
  }

  return (
    <AdminAuthContext.Provider value={{ lock }}>
      {onBack ? <BackButton onClick={onBack} /> : <BackButton />}
      <div className={styles.headerRow}>
        <div className={styles.headerText}>
          <h1 className={styles.pageTitle}>{title}</h1>
          {description && <p className={styles.pageLead}>{description}</p>}
        </div>
        <button type='button' className={styles.lockButton} onClick={lock}>
          ロック
        </button>
      </div>
      {children}
    </AdminAuthContext.Provider>
  );
};
