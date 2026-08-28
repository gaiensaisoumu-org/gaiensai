import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { supabase } from '../../../lib/supabase';
import styles from './InitialRegistration.module.css';
import { useTitle } from '../../../hooks/useTitle';
import Alert from '../../../components/ui/Alert';
import Modal from '../../../components/ui/Modal';
import performancesSnapshot from '../../../generated/performances-static.json';

const STUDENT_ACCOUNT_CONFIRMATION_STORAGE_PREFIX =
  'student-account-confirmed:v1:';

type InitialRegistrationProps = {
  onRegistered: () => Promise<boolean>;
};

const InitialRegistration = ({ onRegistered }: InitialRegistrationProps) => {
  const [availableClubs, setAvailableClubs] = useState<string[]>([]);
  const [selectedClubs, setSelectedClubs] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAccountConfirmationModalOpen, setIsAccountConfirmationModalOpen] =
    useState(false);
  const [isWrongAccountModalOpen, setIsWrongAccountModalOpen] = useState(false);

  useTitle('初回登録 - 生徒用ページ');

  const { route } = useLocation();

  useEffect(() => {
    const snapshot = performancesSnapshot as {
      gymPerformances?: Array<{ group_name?: string | null }>;
    };
    const names = (snapshot.gymPerformances ?? [])
      .map((performance) => performance.group_name)
      .filter((name): name is string => Boolean(name));
    setAvailableClubs(Array.from(new Set(names)).sort());
  }, []);

  useEffect(() => {
    const loadUsername = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUsername(user?.email?.replace('@gaiensai.local', '') ?? '');
      setIsAccountConfirmationModalOpen(true);
    };

    void loadUsername();
  }, []);

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    setErrorMessage(null);

    if (password !== confirmPassword) {
      setErrorMessage('パスワードが一致しません。');
      return;
    }

    const {
      data: { user },
      error: getUserError,
    } = await supabase.auth.getUser();

    if (getUserError || !user) {
      setErrorMessage('ユーザー情報の取得に失敗しました。');
      return;
    }

    const localPart = user.email?.split('@')[0] ?? '';
    const userAffiliation = Number(localPart);

    setLoading(true);

    // パスワードの更新
    const { error: passwordError } = await supabase.auth.updateUser({
      password: password,
    });

    if (passwordError) {
      if (
        passwordError.message.includes(
          'New password should be different from the old password.',
        )
      ) {
        setErrorMessage('パスワードは古いものと異なる必要があります。');
        setLoading(false);
        return;
      }
      setErrorMessage(
        `パスワードの変更に失敗しました: ${passwordError.message}`,
      );
      setLoading(false);
      return;
    }

    // サーバーサイド関数 (RPC) で users テーブルに登録
    const { error } = await supabase.rpc('register_student', {
      affiliation: userAffiliation,
      clubs: selectedClubs.length > 0 ? selectedClubs : null,
    });

    setLoading(false);

    if (error) {
      if (error.code === '23505') {
        setErrorMessage(
          '同じ学年・クラス・番号のユーザーが既に登録されています。入力内容が正しい場合は、お手数ですが、外苑祭総務へお問い合わせください。',
        );
        return;
      }

      setErrorMessage('登録に失敗しました。時間をおいて再度お試しください。');
      return;
    }

    try {
      localStorage.setItem(
        `${STUDENT_ACCOUNT_CONFIRMATION_STORAGE_PREFIX}${user.id}`,
        'true',
      );
    } catch {
      // The database remains the source of truth when storage is unavailable.
    }

    const didRefreshProfile = await onRegistered();
    if (!didRefreshProfile) {
      setErrorMessage(
        '登録情報の反映確認に失敗しました。時間をおいて再度お試しください。',
      );
      return;
    }

    route('/students/dashboard');
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const affiliation = Number(username);
  const hasValidAffiliation = Number.isInteger(affiliation) && affiliation > 0;

  return (
    <section className={styles.registrationContainer}>
      <h1>初回登録</h1>
      <p className={styles.description}>
        初回は登録情報の設定とパスワード変更をお願いします。
      </p>
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.clubSelection}>
          <Alert type='info' style={{ marginTop: '0' }}>
            部活は、引退した3年生は選択する必要はありません。
          </Alert>
          <p className={styles.label}>
            部活(所属しているものをすべて選択してください)
          </p>
          <div className={styles.checkboxGroup}>
            {availableClubs.map((club) => (
              <label key={club} className={styles.checkboxLabel}>
                <input
                  type='checkbox'
                  className={styles.checkbox}
                  checked={selectedClubs.includes(club)}
                  onChange={(e) => {
                    const isChecked = e.currentTarget.checked;
                    setSelectedClubs((prev) =>
                      isChecked
                        ? [...prev, club]
                        : prev.filter((c) => c !== club),
                    );
                  }}
                />
                {club}
              </label>
            ))}
          </div>
        </div>

        <div className={styles.passwordSelection}>
          <input
            type='text'
            name='username'
            value={username}
            autocomplete='username'
            style='display: none;'
            aria-hidden='true'
          />
          <p className={styles.label}>新しいパスワード (8文字以上)</p>
          <input
            type='password'
            className={styles.passwordInput}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            required
            minLength={8}
            autoComplete='new-password'
          />
          <p className={styles.label}>新しいパスワード (確認)</p>
          <input
            type='password'
            className={styles.passwordInput}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.currentTarget.value)}
            required
            minLength={8}
            autoComplete='new-password'
          />
        </div>

        {errorMessage ? <p className={styles.error}>{errorMessage}</p> : null}
        <button
          className={styles.submitButton}
          type='submit'
          disabled={loading}
        >
          {loading ? '登録中...' : '登録する'}
        </button>
      </form>
      <section>
        <button onClick={handleLogout} className={styles.logoutBtn}>
          ログアウト
        </button>
      </section>
      {isAccountConfirmationModalOpen && hasValidAffiliation ? (
        <Modal
          setIsOpen={setIsAccountConfirmationModalOpen}
          handleAction={() => setIsAccountConfirmationModalOpen(false)}
          headingText='アカウントを間違えていませんか？'
          buttonText='はい、確認しました'
          cancelButtonText='間違っています'
          closeOnOverlayClick={false}
          onCancel={() => {
            setIsAccountConfirmationModalOpen(false);
            setIsWrongAccountModalOpen(true);
          }}
        >
          <p>このアカウントで登録される情報です。</p>
          <p className={styles.accountConfirmationAffiliation}>
            {Math.floor(affiliation / 10000)}年
            {Math.floor((affiliation % 10000) / 100)}組{affiliation % 100}番
          </p>
        </Modal>
      ) : null}
      {isWrongAccountModalOpen ? (
        <Modal
          setIsOpen={setIsWrongAccountModalOpen}
          handleAction={handleLogout}
          headingText='ログアウトして、正しいアカウントでログインをし直してください'
          buttonText='ログアウト'
          showCancelButton={false}
          closeOnOverlayClick={false}
        >
          <p>このアカウントでは初回登録を続けないでください。</p>
        </Modal>
      ) : null}
    </section>
  );
};

export default InitialRegistration;
