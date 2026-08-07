import { useEffect, useState } from 'preact/hooks';
import { Route, Router, useLocation } from 'preact-iso';
import { supabase } from '../../../lib/supabase';

import type { Session, UserData } from '../../../types/types';

import JuniorMyPage from './JuniorMyPage';
import Issue from './Issue';
import IssueResult from './IssueResult';

import JuniorLayout from '../../../layout/JuniorLayout';
import {
  readCachedJuniorProfile,
  writeCachedJuniorProfile,
} from './offlineCache';

import styles from '../../../styles/sub-pages.module.css';
import NotFound from '../../../shared/NotFound';
import Login from './Login';
import LoadingSpinner from '../../../components/ui/LoadingSpinner';
import { useTitle } from '../../../hooks/useTitle';
import InitialRegistration from './InitialRegistration';
import JuniorSignUp from './JuniorSignUp';
import { withTimeout } from '../../../utils/withTimeout';

type AuthState = Session | null | undefined;
type UserDataState = UserData | null | undefined; // undefined: 読み込み前, null: 未登録

const JUNIOR_AFFILIATION_THRESHOLD = 100000;
const STUDENT_ID_MIN = 10000;
const STUDENT_ID_MAX = 40000;
const SUPABASE_RESPONSE_TIMEOUT_MS = 8000;

const isStudentAccountByEmail = (email?: string | null): boolean => {
  const localPart = email?.split('@')[0] ?? '';
  const idAsNumber = Number(localPart);
  return (
    Number.isInteger(idAsNumber) &&
    idAsNumber >= STUDENT_ID_MIN &&
    idAsNumber <= STUDENT_ID_MAX
  );
};

const Junior = () => {
  const { path, route } = useLocation();
  const [session, setSession] = useState<AuthState>(undefined);
  const [userData, setUserData] = useState<UserDataState>(undefined);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useTitle('中学生用ページ');

  const formatErrorMessage = (error: unknown) => {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  };

  const preserveQuery = (targetPath: string): string => {
    const search = window.location.search;
    if (!search || targetPath.includes('?')) {
      return targetPath;
    }
    return `${targetPath}${search}`;
  };

  const loadUserProfile = async (userId: string) => {
    try {
      const { data, error }: { data: UserData; error: unknown } =
        await withTimeout(
          supabase
            .from('users')
            .select('email, affiliation, junior_usage_type, application_day')
            .eq('id', userId)
            .maybeSingle(),
          SUPABASE_RESPONSE_TIMEOUT_MS,
        );

      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  };

  // register_junior直後にusersの行が即時にselectで見えないタイミングがあるため
  const handleRegistered = async (commit = true): Promise<boolean> => {
    if (!session) {
      return false;
    }

    for (let i = 0; i < 3; i++) {
      const { data, error } = await loadUserProfile(session.user.id);

      if (!error && data) {
        if (commit) {
          setUserData(data);
          writeCachedJuniorProfile(session.user.id, data);
        }
        return true;
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, 200);
      });
    }

    return false;
  };

  // 無限ループを防ぐため、パスごとにリカバリーを試行したかを記録するState
  const [hasAttemptedRecovery, setHasAttemptedRecovery] = useState(false);

  // パスが変わるたびにリカバリーフラグをリセット
  useEffect(() => {
    setHasAttemptedRecovery(false);
  }, [path]);

  // userDataがnullの場合に、InitialRegistrationを見せる前にローディング画面を挟んで再取得を試みる
  useEffect(() => {
    if (
      session &&
      userData === null &&
      !isLoading &&
      !profileError &&
      path !== '/junior/signup' &&
      !hasAttemptedRecovery
    ) {
      setHasAttemptedRecovery(true);
      const recoverProfile = async () => {
        setIsLoading(true);
        await handleRegistered(true);
        setIsLoading(false);
      };
      void recoverProfile();
    }
  }, [session, userData, isLoading, profileError, path, hasAttemptedRecovery]);

  useEffect(() => {
    const loadProfile = async (nextSession: Session | null) => {
      setSession(nextSession);
      setProfileError(null);
      setIsLoading(true);

      if (!nextSession) {
        setUserData(null);
        setIsLoading(false);
        if (path === '/junior/signup') {
          route(preserveQuery('/junior/signup'), true);
        } else if (path !== '/') {
          route(preserveQuery('/junior/login'), true);
        }
        return;
      }

      const { data, error } = await loadUserProfile(nextSession.user.id);

      if (error) {
        const cachedProfile = readCachedJuniorProfile(nextSession.user.id);
        if (cachedProfile) {
          setUserData(cachedProfile);
          setIsLoading(false);
          return;
        }

        setProfileError(formatErrorMessage(error));
        setIsLoading(false);
        return;
      }

      setUserData(data ?? null);
      if (data) {
        writeCachedJuniorProfile(nextSession.user.id, data);
      }
      setIsLoading(false);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (
        event !== 'INITIAL_SESSION' &&
        event !== 'SIGNED_IN' &&
        event !== 'SIGNED_OUT' &&
        event !== 'USER_UPDATED'
      ) {
        return;
      }
      void loadProfile(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Guard / Redirect Effect
  useEffect(() => {
    if (isLoading || session === undefined || userData === undefined) {
      return;
    }

    if (!session) {
      return;
    }

    if (profileError) {
      return;
    }

    const isStudentAccount = isStudentAccountByEmail(session.user.email);

    // 高校生（生徒）アカウントの場合は /students へ置換遷移
    if (userData && userData.affiliation < JUNIOR_AFFILIATION_THRESHOLD) {
      route(preserveQuery('/students'), true);
      return;
    }

    if (!userData && isStudentAccount) {
      route(preserveQuery('/students'), true);
      return;
    }

    // 中学生マイページへの自動遷移（replace: true）
    if (
      userData &&
      (path === '/junior' ||
        path === '/junior/login' ||
        path === '/junior/signup' ||
        path === '/junior/')
    ) {
      route(preserveQuery('/junior/mypage'), true);
    }
  }, [path, profileError, route, session, userData, isLoading]);

  const retryLoadProfile = async () => {
    if (!session) {
      return;
    }

    setProfileError(null);
    setIsLoading(true);
    const { data, error } = await loadUserProfile(session.user.id);

    if (error) {
      const cachedProfile = readCachedJuniorProfile(session.user.id);
      if (cachedProfile) {
        setUserData(cachedProfile);
        setIsLoading(false);
        return;
      }

      setProfileError(formatErrorMessage(error));
      setIsLoading(false);
      return;
    }

    setUserData(data ?? null);
    if (data) {
      writeCachedJuniorProfile(session.user.id, data);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    // 登録完了後に /junior/mypage に飛んできた際、userDataがまだnullなら再取得する
    if (session && userData === null && path === '/junior/mypage') {
      void retryLoadProfile();
    }
  }, [path]);

  if (isLoading) {
    return (
      <section>
        <h1 className={styles.pageTitle}>中学生用ページ</h1>
        <LoadingSpinner />
        <p>
          しばらく待ってもページが遷移しない場合は、
          <a href={preserveQuery('/junior/login')}>ログインページ</a>または
          <a href={preserveQuery('/junior/mypage')}>マイページ</a>
          のいずれかに直接アクセスしてみてください。
        </p>
        <p>不明点がありましたら、お気軽に外苑祭総務へお問い合わせください。</p>
      </section>
    );
  }

  if (!session || path === '/junior/signup') {
    return (
      <JuniorLayout>
        <Router>
          <Route path='/signup' component={JuniorSignUp} />
          <Route default component={Login} />
        </Router>
      </JuniorLayout>
    );
  }

  if (profileError && userData === null) {
    return (
      <section>
        <h1 className={styles.pageTitle}>中学生用ページ</h1>
        <h2>プロフィールを読み込めませんでした</h2>
        <p>オフライン状態、または通信エラーの可能性があります。</p>
        <p>通信状態を確認して、再読み込みをお試しください。</p>
        <button type='button' onClick={() => void retryLoadProfile()}>
          再試行
        </button>
        <p>詳細: {profileError}</p>
      </section>
    );
  }

  if (userData === null) {
    return (
      <JuniorLayout>
        <InitialRegistration onRegistered={handleRegistered} />
      </JuniorLayout>
    );
  }

  // TypeScript型ガード：ここより下では userData は確実に UserData 型
  if (!userData) {
    return (
      <section>
        <LoadingSpinner />
      </section>
    );
  }

  const registeredUserData = userData;

  return (
    <JuniorLayout>
      <Router>
        <Route path='/issue/result' component={IssueResult} />
        <Route path='/issue' component={Issue} />
        <Route
          path='/mypage'
          component={() => <JuniorMyPage userData={registeredUserData} />}
        />
        <Route
          path='/initial-registration'
          component={() => <JuniorMyPage userData={registeredUserData} />}
        />
        <Route
          path='/'
          component={() => <JuniorMyPage userData={registeredUserData} />}
        />
        <Route default component={NotFound} />
      </Router>
    </JuniorLayout>
  );
};

export default Junior;
