import { useEffect, useMemo, useState } from 'preact/hooks';
import { useEventConfig } from '../../hooks/useEventConfig';
import { useTitle } from '../../hooks/useTitle';
import { supabase } from '../../lib/supabase';
import {
  AdminAuthLayout,
  getSessionToken,
  readErrorMessage,
} from '../../layout/AdminAuthLayout';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import NormalSection from '../../components/ui/NormalSection';
import styles from './Settings.module.css';
import Alert from '../../components/ui/Alert';
import Switch from '../../components/ui/Switch';

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const generateBase58Password = (length = 8): string => {
  let result = '';
  const charactersLength = BASE58_ALPHABET.length;
  for (let i = 0; i < length; i++) {
    result += BASE58_ALPHABET.charAt(
      Math.floor(Math.random() * charactersLength),
    );
  }
  return result;
};

type StudentUser = {
  studentId: string;
  email: string;
  clubs: string[];
  isInitialRegistrationComplete: boolean;
  lastSignIn?: string;
  createdAt: string;
};

type BulkCreateResponse = {
  created: number;
  skipped: number;
  errors: string[];
  failedUsers?: { id: string; password: string }[];
};

type PasswordResetMode = 'random' | 'manual';

const isStudentAccountId = (id: string): boolean => {
  const numericId = Number(id);
  return (
    Number.isInteger(numericId) && numericId >= 10000 && numericId <= 40000
  );
};

const StudentAccountsContent = () => {
  const { config } = useEventConfig();
  const [maxGrade, setMaxGrade] = useState(config.grade_number);
  const [maxClass, setMaxClass] = useState(config.class_number);
  const [maxAttendance, setMaxAttendance] = useState(
    config.max_attendance_number,
  );
  const [useTestPassword, setUseTestPassword] = useState(false);
  const [singleGrade, setSingleGrade] = useState('');
  const [singleClass, setSingleClass] = useState('');
  const [singleAttendance, setSingleAttendance] = useState('');
  const [isCreatingSingle, setIsCreatingSingle] = useState(false);
  const [singleCreateResult, setSingleCreateResult] = useState<{
    type: 'success' | 'error';
    text: string;
    id?: string;
    password?: string;
  } | null>(null);

  const [filterGrade, setFilterGrade] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [filterAttendance, setFilterAttendance] = useState('');

  const [existingSearchId, setExistingSearchId] = useState('');
  const [existingFilterGrade, setExistingFilterGrade] = useState('');
  const [existingFilterClass, setExistingFilterClass] = useState('');
  const [existingFilterAttendance, setExistingFilterAttendance] = useState('');
  const [
    existingFilterInitialRegistration,
    setExistingFilterInitialRegistration,
  ] = useState('');
  const [existingFilterClub, setExistingFilterClub] = useState('');

  const [generatedAccounts, setGeneratedAccounts] = useState<
    { id: string; password: string }[]
  >([]);
  const [existingUsers, setExistingUsers] = useState<StudentUser[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [availableClubs, setAvailableClubs] = useState<string[]>([]);
  const [clubEditTarget, setClubEditTarget] = useState<StudentUser | null>(
    null,
  );
  const [editedClubs, setEditedClubs] = useState<string[]>([]);
  const [clubEditError, setClubEditError] = useState<string | null>(null);
  const [isSavingClubs, setIsSavingClubs] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
  }>({ current: 0, total: 0 });
  const [message, setMessage] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);
  const [generationErrors, setGenerationErrors] = useState<string[]>([]);
  const [passwordResetTarget, setPasswordResetTarget] = useState<{
    studentId: string;
    randomPassword: string;
  } | null>(null);
  const [passwordResetMode, setPasswordResetMode] =
    useState<PasswordResetMode>('random');
  const [manualResetPassword, setManualResetPassword] = useState('');
  const [manualResetPasswordConfirm, setManualResetPasswordConfirm] =
    useState('');
  const [passwordResetError, setPasswordResetError] = useState<string | null>(
    null,
  );
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [passwordResetResult, setPasswordResetResult] = useState<{
    studentId: string;
    password: string;
  } | null>(null);
  const [passwordCopyMessage, setPasswordCopyMessage] = useState<string | null>(
    null,
  );
  const [accountActionEmail, setAccountActionEmail] = useState<string | null>(
    null,
  );

  useTitle('生徒アカウント管理 - 管理画面');

  const fetchExistingUsers = async () => {
    setIsLoadingUsers(true);
    try {
      const token = getSessionToken();
      const { data, error } = await supabase.functions.invoke('admin-auth', {
        body: { action: 'getStudentUsers' },
        headers: { 'x-admin-session-token': token ?? '' },
      });
      if (error) {
        throw error;
      }
      const users = (data?.users || []).filter((user: StudentUser) =>
        isStudentAccountId(user.studentId),
      );
      setExistingUsers(users);
    } catch (err) {
      const errorMsg = await readErrorMessage(err);
      setMessage({
        text: `一覧の取得に失敗しました: ${errorMsg}`,
        type: 'error',
      });
    } finally {
      setIsLoadingUsers(false);
    }
  };

  useEffect(() => {
    void fetchExistingUsers();
  }, []);

  useEffect(() => {
    const fetchAvailableClubs = async () => {
      const { data, error } = await supabase
        .from('gym_performances')
        .select('group_name');

      if (!error && data) {
        setAvailableClubs(
          Array.from(
            new Set(
              data.map((performance) => performance.group_name).filter(Boolean),
            ),
          ).sort(),
        );
      }
    };

    void fetchAvailableClubs();
  }, []);

  const filteredAccounts = useMemo(() => {
    return generatedAccounts.filter((acc) => {
      // IDフォーマット: (学年1桁)(クラス2桁)(番号2桁) 例: 10101
      const g = acc.id.charAt(0);
      const c = acc.id.substring(1, 3);
      const n = acc.id.substring(3, 5);

      const matchGrade = filterGrade === '' || g === filterGrade;
      const matchClass =
        filterClass === '' || c === String(filterClass).padStart(2, '0');
      const matchAttendance =
        filterAttendance === '' ||
        n === String(filterAttendance).padStart(2, '0');

      return matchGrade && matchClass && matchAttendance;
    });
  }, [generatedAccounts, filterGrade, filterClass, filterAttendance]);

  const filteredExistingUsers = useMemo(() => {
    return existingUsers.filter((user) => {
      // IDフォーマット: (学年1桁)(クラス2桁)(番号2桁) 例: 10101
      const id = user.studentId;
      const g = id.charAt(0);
      const c = id.substring(1, 3);
      const n = id.substring(3, 5);

      const matchSearch =
        existingSearchId === '' || id.includes(existingSearchId);
      const matchGrade =
        existingFilterGrade === '' || g === existingFilterGrade;
      const matchClass =
        existingFilterClass === '' ||
        c === String(existingFilterClass).padStart(2, '0');
      const matchAttendance =
        existingFilterAttendance === '' ||
        n === String(existingFilterAttendance).padStart(2, '0');
      const matchInitialRegistration =
        existingFilterInitialRegistration === '' ||
        (existingFilterInitialRegistration === 'completed'
          ? user.isInitialRegistrationComplete
          : !user.isInitialRegistrationComplete);
      const matchClub =
        existingFilterClub === '' ||
        (existingFilterClub === '__none__'
          ? user.clubs.length === 0
          : user.clubs.includes(existingFilterClub));

      return (
        matchSearch &&
        matchGrade &&
        matchClass &&
        matchAttendance &&
        matchInitialRegistration &&
        matchClub
      );
    });
  }, [
    existingUsers,
    existingSearchId,
    existingFilterGrade,
    existingFilterClass,
    existingFilterAttendance,
    existingFilterInitialRegistration,
    existingFilterClub,
  ]);

  const existingClubOptions = useMemo(
    () =>
      Array.from(
        new Set(existingUsers.flatMap((user) => user.clubs).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b, 'ja')),
    [existingUsers],
  );

  const handleSingleCreate = async (event: Event) => {
    event.preventDefault();
    const grade = Number(singleGrade);
    const classNumber = Number(singleClass);
    const attendance = Number(singleAttendance);
    if (
      !Number.isInteger(grade) ||
      !Number.isInteger(classNumber) ||
      !Number.isInteger(attendance) ||
      grade < 1 ||
      grade > config.grade_number ||
      classNumber < 1 ||
      classNumber > config.class_number ||
      attendance < 1 ||
      attendance > config.max_attendance_number
    ) {
      setSingleCreateResult({
        type: 'error',
        text: `学年は1〜${config.grade_number}、クラスは1〜${config.class_number}、出席番号は1〜${config.max_attendance_number}で入力してください。`,
      });
      return;
    }
    const id = `${grade}${String(classNumber).padStart(2, '0')}${String(attendance).padStart(2, '0')}`;
    const password = generateBase58Password();
    setIsCreatingSingle(true);
    setSingleCreateResult(null);
    try {
      const { data, error } =
        await supabase.functions.invoke<BulkCreateResponse>('admin-auth', {
          body: { action: 'bulkCreateUsers', users: [{ id, password }] },
          headers: { 'x-admin-session-token': getSessionToken() ?? '' },
        });
      if (error) {
        throw error;
      }
      if ((data?.created ?? 0) > 0) {
        setSingleCreateResult({
          type: 'success',
          text: '生徒アカウントを登録しました。パスワードはこの画面を閉じる前に控えてください。',
          id,
          password,
        });
        setSingleGrade('');
        setSingleClass('');
        setSingleAttendance('');
        await fetchExistingUsers();
        return;
      }
      if ((data?.skipped ?? 0) > 0) {
        setSingleCreateResult({
          type: 'error',
          text: 'このIDは既に登録されています。',
        });
        return;
      }
      throw new Error(data?.errors?.[0] ?? 'アカウントの登録に失敗しました。');
    } catch (err) {
      setSingleCreateResult({
        type: 'error',
        text: `登録に失敗しました: ${await readErrorMessage(err)}`,
      });
    } finally {
      setIsCreatingSingle(false);
    }
  };

  const handleGenerate = async () => {
    if (!window.confirm('一括生成を開始しますか？')) {
      return;
    }

    setIsGenerating(true);
    setMessage(null);
    setGenerationErrors([]);
    const accounts: { id: string; password: string }[] = [];
    const BATCH_SIZE = 10;
    const MAX_RETRIES = 3;

    for (let g = 1; g <= maxGrade; g++) {
      for (let c = 1; c <= maxClass; c++) {
        for (let n = 1; n <= maxAttendance; n++) {
          const id = `${g}${String(c).padStart(2, '0')}${String(n).padStart(2, '0')}`;
          accounts.push({
            id,
            password: useTestPassword ? '0000' : generateBase58Password(),
          });
        }
      }
    }

    setProgress({ current: 0, total: accounts.length });

    let totalCreated = 0;
    let totalSkipped = 0;
    let resolvedCount = 0;
    const finalErrorsMap = new Map<string, string>();
    let currentQueue = [...accounts];
    let retryAttempt = 0;

    try {
      const token = getSessionToken();

      while (currentQueue.length > 0 && retryAttempt <= MAX_RETRIES) {
        const nextQueue: typeof accounts = [];
        const isRetry = retryAttempt > 0;
        const currentBatchSize = isRetry ? 5 : BATCH_SIZE; // リトライ時はバッチを小さくして安定性を高める

        for (let i = 0; i < currentQueue.length; i += currentBatchSize) {
          const batch = currentQueue.slice(i, i + currentBatchSize);

          try {
            const { data, error } =
              await supabase.functions.invoke<BulkCreateResponse>(
                'admin-auth',
                {
                  body: { action: 'bulkCreateUsers', users: batch },
                  headers: { 'x-admin-session-token': token ?? '' },
                },
              );

            if (error) {
              throw error;
            }

            if (data) {
              totalCreated += data.created;
              totalSkipped += data.skipped;
              resolvedCount += data.created + data.skipped;

              const failedIds = new Set(
                data.failedUsers?.map((f) => f.id) || [],
              );
              // 1. 今回のバッチでエラーに含まれなかったIDは、成功またはスキップ（登録済）
              //    なのでエラーマップから削除する
              batch.forEach((u) => {
                if (!failedIds.has(u.id)) {
                  finalErrorsMap.delete(u.id);
                }
              });

              // 2. 今回失敗したもののメッセージを記録（上書き）
              data.errors?.forEach((errMsg) => {
                const id = errMsg.split(':')[0]?.trim();
                if (id) {
                  finalErrorsMap.set(id, errMsg);
                }
              });

              if (data.failedUsers) {
                nextQueue.push(...data.failedUsers);
              }
            }
          } catch (err) {
            // ネットワークエラー等の場合はバッチごと次の試行へ回す
            batch.forEach((u) => {
              finalErrorsMap.set(u.id, `${u.id}: 通信エラーまたはタイムアウト`);
            });
            nextQueue.push(...batch);
          }

          setProgress({
            current: Math.min(resolvedCount, accounts.length),
            total: accounts.length,
          });
        }

        currentQueue = nextQueue;
        retryAttempt++;
        if (currentQueue.length > 0 && retryAttempt <= MAX_RETRIES) {
          // 指数バックオフ的な待機（1秒, 2回目は2秒...）
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * retryAttempt),
          );
        }
      }

      // リトライしきれなかったものが残っている場合も進捗を100%にする
      if (currentQueue.length > 0) {
        setProgress({ current: accounts.length, total: accounts.length });
      }

      const allErrors = Array.from(finalErrorsMap.values());
      setGeneratedAccounts(accounts);
      setGenerationErrors(allErrors);
      setMessage({
        text: `作成完了: 新規 ${totalCreated}件 (スキップ: ${totalSkipped}件)${allErrors.length > 0 ? ` ※最終的な失敗 ${allErrors.length}件` : ''}`,
        type: 'success',
      });
      void fetchExistingUsers(); // 作成後に一覧を更新
    } catch (err) {
      const errorMsg = await readErrorMessage(err);
      setMessage({ text: `失敗しました: ${errorMsg}`, type: 'error' });
    } finally {
      setIsGenerating(false);
    }
  };

  const openPasswordResetModal = (studentId: string) => {
    setPasswordResetTarget({
      studentId,
      randomPassword: generateBase58Password(),
    });
    setPasswordResetMode('random');
    setManualResetPassword('');
    setManualResetPasswordConfirm('');
    setPasswordResetError(null);
  };

  const closePasswordResetModal = () => {
    if (!isResettingPassword) {
      setPasswordResetTarget(null);
    }
  };

  const openClubEditModal = (user: StudentUser) => {
    setClubEditTarget(user);
    setEditedClubs(user.clubs);
    setClubEditError(null);
  };

  const closeClubEditModal = () => {
    if (!isSavingClubs) {
      setClubEditTarget(null);
    }
  };

  const handleSaveClubs = async (event: Event) => {
    event.preventDefault();
    if (!clubEditTarget) {
      return;
    }

    setClubEditError(null);
    setIsSavingClubs(true);
    try {
      const token = getSessionToken();
      const { error } = await supabase.functions.invoke('admin-auth', {
        body: {
          action: 'updateStudentClubs',
          studentId: clubEditTarget.studentId,
          clubs: editedClubs,
        },
        headers: { 'x-admin-session-token': token ?? '' },
      });

      if (error) {
        throw error;
      }

      setExistingUsers((users) =>
        users.map((user) =>
          user.studentId === clubEditTarget.studentId
            ? { ...user, clubs: editedClubs }
            : user,
        ),
      );
      setClubEditTarget(null);
    } catch (err) {
      const errorMsg = await readErrorMessage(err);
      setClubEditError(`変更に失敗しました: ${errorMsg}`);
    } finally {
      setIsSavingClubs(false);
    }
  };

  const handleResetPassword = async (event: Event) => {
    event.preventDefault();
    if (!passwordResetTarget) {
      return;
    }

    setPasswordResetError(null);
    const newPassword =
      passwordResetMode === 'random'
        ? passwordResetTarget.randomPassword
        : manualResetPassword;

    if (passwordResetMode === 'manual') {
      if (newPassword.length < 8) {
        setPasswordResetError('パスワードは8文字以上で入力してください。');
        return;
      }
      if (newPassword !== manualResetPasswordConfirm) {
        setPasswordResetError('パスワードと確認用パスワードが一致しません。');
        return;
      }
    }

    setIsResettingPassword(true);
    try {
      const token = getSessionToken();
      const { error } = await supabase.functions.invoke('admin-auth', {
        body: {
          action: 'resetUserPassword',
          studentId: passwordResetTarget.studentId,
          newPassword,
        },
        headers: { 'x-admin-session-token': token ?? '' },
      });
      if (error) {
        throw error;
      }

      setPasswordResetTarget(null);
      setPasswordResetResult({
        studentId: passwordResetTarget.studentId,
        password: newPassword,
      });
      setPasswordCopyMessage(null);
    } catch (err) {
      const errorMsg = await readErrorMessage(err);
      setPasswordResetError(`変更に失敗しました: ${errorMsg}`);
    } finally {
      setIsResettingPassword(false);
    }
  };

  const copyResetPassword = async () => {
    if (!passwordResetResult) {
      return;
    }

    try {
      await navigator.clipboard.writeText(passwordResetResult.password);
      setPasswordCopyMessage('パスワードをコピーしました。');
    } catch {
      setPasswordCopyMessage(
        'コピーできませんでした。表示欄からパスワードを選択してコピーしてください。',
      );
    }
  };

  const handleAccountAction = async (
    user: StudentUser,
    action: 'resetUserData' | 'deleteUserAccount',
  ) => {
    const isDeletingAccount = action === 'deleteUserAccount';
    const confirmed = window.confirm(
      isDeletingAccount
        ? `ID: ${user.studentId} のチケット・ユーザーデータ・ログイン情報をすべて削除します。元に戻せません。続行しますか？`
        : `ID: ${user.studentId} の発券済みチケットとユーザーデータを削除します。ログイン情報は残ります。続行しますか？`,
    );
    if (!confirmed) {
      return;
    }
    setAccountActionEmail(user.email);
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke<{
        deletedTickets: number;
      }>('admin-auth', {
        body: { action, accountType: 'student', userEmail: user.email },
        headers: { 'x-admin-session-token': getSessionToken() ?? '' },
      });
      if (error) {
        throw error;
      }
      await fetchExistingUsers();
      setMessage({
        type: 'success',
        text: isDeletingAccount
          ? `ID: ${user.studentId} のユーザーを削除しました。`
          : `ID: ${user.studentId} のユーザーデータを消去しました（チケット ${data?.deletedTickets ?? 0} 件）。`,
      });
    } catch (err) {
      setMessage({
        type: 'error',
        text: `操作に失敗しました: ${await readErrorMessage(err)}`,
      });
    } finally {
      setAccountActionEmail(null);
    }
  };

  const handleExportCSV = (onlyFiltered = false) => {
    const targets = onlyFiltered ? filteredAccounts : generatedAccounts;
    if (targets.length === 0) {
      return;
    }

    const headers = ['id', 'password'];
    const rows = targets.map((a) => `${a.id},${a.password}`);
    const content = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `student_accounts_${Date.now()}.csv`;
    link.click();
  };

  return (
    <div className={styles.container}>
      <NormalSection>
        <h2>生徒アカウントを1件登録</h2>
        <p className={styles.noteText}>
          学年・クラス・出席番号を指定して、生徒アカウントを1件だけ登録します。
        </p>
        <form onSubmit={handleSingleCreate}>
          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='single-student-grade'
              >
                学年
              </label>
              <input
                id='single-student-grade'
                type='number'
                min='1'
                max={config.grade_number}
                className={styles.fieldControl}
                value={singleGrade}
                onInput={(event) =>
                  setSingleGrade((event.target as HTMLInputElement).value)
                }
                required
              />
            </div>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='single-student-class'
              >
                クラス
              </label>
              <input
                id='single-student-class'
                type='number'
                min='1'
                max={config.class_number}
                className={styles.fieldControl}
                value={singleClass}
                onInput={(event) =>
                  setSingleClass((event.target as HTMLInputElement).value)
                }
                required
              />
            </div>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='single-student-attendance'
              >
                出席番号
              </label>
              <input
                id='single-student-attendance'
                type='number'
                min='1'
                max={config.max_attendance_number}
                className={styles.fieldControl}
                value={singleAttendance}
                onInput={(event) =>
                  setSingleAttendance((event.target as HTMLInputElement).value)
                }
                required
              />
            </div>
          </div>
          <div className={styles.saveButtonContainer}>
            <button
              type='submit'
              className={`${styles.authButton} ${styles.saveButtonPrimary}`}
              disabled={isCreatingSingle}
            >
              {isCreatingSingle ? '登録中...' : '1件登録'}
            </button>
          </div>
        </form>
        {singleCreateResult && (
          <div
            className={
              singleCreateResult.type === 'success'
                ? styles.authSuccess
                : styles.authError
            }
          >
            <p>{singleCreateResult.text}</p>
            {singleCreateResult.id && singleCreateResult.password && (
              <p>
                ID:{' '}
                <code className={styles.codePassword}>
                  {singleCreateResult.id}
                </code>
                {' / '}パスワード:{' '}
                <code className={styles.codePassword}>
                  {singleCreateResult.password}
                </code>
              </p>
            )}
          </div>
        )}
      </NormalSection>
      {(existingUsers.length === 0 || generatedAccounts.length > 0) && (
        <NormalSection>
          <h2>生徒アカウント生成</h2>
          <p className={styles.noteText}>
            学年・クラス・番号の最大値を指定して、全組み合わせを生成します。
          </p>
          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label className={styles.settingLabel}>学年数</label>
              <input
                type='number'
                className={styles.fieldControl}
                value={maxGrade}
                onInput={(e) =>
                  setMaxGrade(Number((e.target as HTMLInputElement).value))
                }
              />
            </div>
            <div className={styles.field}>
              <label className={styles.settingLabel}>クラス数</label>
              <input
                type='number'
                className={styles.fieldControl}
                value={maxClass}
                onInput={(e) =>
                  setMaxClass(Number((e.target as HTMLInputElement).value))
                }
              />
            </div>
            <div className={styles.field}>
              <label className={styles.settingLabel}>最大出席番号</label>
              <input
                type='number'
                className={styles.fieldControl}
                value={maxAttendance}
                onInput={(e) =>
                  setMaxAttendance(Number((e.target as HTMLInputElement).value))
                }
              />
            </div>
            <div className={styles.field}>
              <span className={styles.settingLabel}>
                テスト用パスワード (0000)
              </span>
              <label>
                <Switch
                  checked={useTestPassword}
                  onChange={(checked) => setUseTestPassword(checked)}
                />
              </label>
            </div>
          </div>

          <div className={styles.saveButtonContainer}>
            {generatedAccounts.length === 0 && (
              <button
                className={`${styles.authButton} ${styles.saveButtonPrimary}`}
                onClick={handleGenerate}
                disabled={isGenerating}
              >
                {isGenerating ? '実行中...' : '一括生成・登録を実行'}
              </button>
            )}
            {generatedAccounts.length > 0 && (
              <button
                className={`${styles.authButton} ${styles.saveButtonSecondary}`}
                onClick={() => handleExportCSV(false)}
              >
                CSVダウンロード ({generatedAccounts.length}件)
              </button>
            )}
          </div>

          {message && (
            <>
              <p
                className={
                  message.type === 'success'
                    ? styles.authSuccess
                    : styles.authError
                }
              >
                {message.text}
              </p>
              {generationErrors.length > 0 && (
                <div
                  className={styles.authError}
                  style={{
                    marginTop: '0.5rem',
                    fontWeight: 'normal',
                    fontSize: '0.9rem',
                  }}
                >
                  <p style={{ fontWeight: 'bold', marginBottom: '0.2rem' }}>
                    発生したエラーの内容:
                  </p>
                  <ul style={{ paddingLeft: '1.2rem', margin: 0 }}>
                    {Array.from(new Set(generationErrors))
                      .slice(0, 5)
                      .map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    {new Set(generationErrors).size > 5 && (
                      <li>
                        ...他 {new Set(generationErrors).size - 5}{' '}
                        件のエラーが発生しました
                      </li>
                    )}
                  </ul>
                </div>
              )}
              {useTestPassword && (
                <Alert type='warning'>
                  テスト用パスワード (0000)
                  を使用しています。本番環境では使用しないでください。
                </Alert>
              )}
              {!useTestPassword && (
                <Alert type='warning'>
                  パスワードを再度表示することはできません。必ずCSVダウンロードをしてください。
                </Alert>
              )}
            </>
          )}
        </NormalSection>
      )}

      {generatedAccounts.length > 0 && (
        <NormalSection>
          <h2>生成済みユーザー一覧</h2>
          <div className={styles.filterArea}>
            <div className={`${styles.field} ${styles.filterField}`}>
              <label className={`${styles.settingLabel} ${styles.filterLabel}`}>
                学年:
              </label>
              <input
                type='number'
                placeholder='全学年'
                className={`${styles.fieldControl} ${styles.filterInputSmall}`}
                value={filterGrade}
                onInput={(e) =>
                  setFilterGrade((e.target as HTMLInputElement).value)
                }
              />
            </div>
            <div className={`${styles.field} ${styles.filterField}`}>
              <label className={`${styles.settingLabel} ${styles.filterLabel}`}>
                クラス:
              </label>
              <input
                type='number'
                placeholder='全組'
                className={`${styles.fieldControl} ${styles.filterInputSmall}`}
                value={filterClass}
                onInput={(e) =>
                  setFilterClass((e.target as HTMLInputElement).value)
                }
              />
            </div>
            <div className={`${styles.field} ${styles.filterField}`}>
              <label className={`${styles.settingLabel} ${styles.filterLabel}`}>
                出席番号:
              </label>
              <input
                type='number'
                placeholder='全員'
                className={`${styles.fieldControl} ${styles.filterInputSmall}`}
                value={filterAttendance}
                onInput={(e) =>
                  setFilterAttendance((e.target as HTMLInputElement).value)
                }
              />
            </div>
            <button
              type='button'
              className={styles.inlineEditButton}
              onClick={() => {
                setFilterGrade('');
                setFilterClass('');
                setFilterAttendance('');
              }}
            >
              リセット
            </button>
            <span className={styles.filterCount}>
              該当: {filteredAccounts.length} / {generatedAccounts.length} 件
            </span>
          </div>

          <div className={styles.headerRow}>
            <button
              type='button'
              className={`${styles.saveButtonSecondary}`}
              onClick={() => handleExportCSV(true)}
              disabled={filteredAccounts.length === 0}
            >
              表示中のみCSV保存
            </button>
          </div>

          <p className={styles.tableScrollHint}>← 横にスクロールできます →</p>
          <div className={styles.tableWrapper}>
            <table className={styles.managementTable}>
              <thead>
                <tr>
                  <th>学年クラス番号 (ID)</th>
                  <th>パスワード</th>
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map((acc) => (
                  <tr key={acc.id}>
                    <td>{acc.id}</td>
                    <td>
                      <code className={styles.codePassword}>
                        {acc.password}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </NormalSection>
      )}

      {existingUsers.length > 0 && (
        <NormalSection>
          <div className={styles.headerRow}>
            <h2>登録済みアカウント管理</h2>
            <button
              type='button'
              className={styles.inlineEditButton}
              onClick={fetchExistingUsers}
              disabled={isLoadingUsers}
            >
              {isLoadingUsers ? '更新中...' : '一覧を更新'}
            </button>
          </div>

          <Alert type='info'>
            生徒用アカウントを再度生成するには、一度既存のアカウントを全て削除してください。
          </Alert>

          <div className={styles.filterArea}>
            <div className={`${styles.field} ${styles.filterField}`}>
              <label className={`${styles.settingLabel} ${styles.filterLabel}`}>
                ID検索:
              </label>
              <input
                type='text'
                placeholder='IDの一部'
                className={`${styles.fieldControl} ${styles.filterInputId}`}
                value={existingSearchId}
                onInput={(e) =>
                  setExistingSearchId((e.target as HTMLInputElement).value)
                }
              />
            </div>
            <div className={`${styles.field} ${styles.filterField}`}>
              <label className={`${styles.settingLabel} ${styles.filterLabel}`}>
                学年:
              </label>
              <input
                type='number'
                placeholder='全学年'
                className={`${styles.fieldControl} ${styles.filterInputSmall}`}
                value={existingFilterGrade}
                onInput={(e) =>
                  setExistingFilterGrade((e.target as HTMLInputElement).value)
                }
              />
            </div>
            <div className={`${styles.field} ${styles.filterField}`}>
              <label className={`${styles.settingLabel} ${styles.filterLabel}`}>
                クラス:
              </label>
              <input
                type='number'
                placeholder='全組'
                className={`${styles.fieldControl} ${styles.filterInputSmall}`}
                value={existingFilterClass}
                onInput={(e) =>
                  setExistingFilterClass((e.target as HTMLInputElement).value)
                }
              />
            </div>
            <div className={`${styles.field} ${styles.filterField}`}>
              <label className={`${styles.settingLabel} ${styles.filterLabel}`}>
                出席番号:
              </label>
              <input
                type='number'
                placeholder='全員'
                className={`${styles.fieldControl} ${styles.filterInputSmall}`}
                value={existingFilterAttendance}
                onInput={(e) =>
                  setExistingFilterAttendance(
                    (e.target as HTMLInputElement).value,
                  )
                }
              />
            </div>
            <div className={`${styles.field} ${styles.filterField}`}>
              <label className={`${styles.settingLabel} ${styles.filterLabel}`}>
                初回登録:
              </label>
              <select
                className={styles.fieldControl}
                value={existingFilterInitialRegistration}
                onChange={(e) =>
                  setExistingFilterInitialRegistration(
                    (e.target as HTMLSelectElement).value,
                  )
                }
              >
                <option value=''>すべて</option>
                <option value='completed'>済み</option>
                <option value='not-completed'>未登録</option>
              </select>
            </div>
            <div className={`${styles.field} ${styles.filterField}`}>
              <label className={`${styles.settingLabel} ${styles.filterLabel}`}>
                部活:
              </label>
              <select
                className={styles.fieldControl}
                value={existingFilterClub}
                onChange={(e) =>
                  setExistingFilterClub((e.target as HTMLSelectElement).value)
                }
              >
                <option value=''>すべて</option>
                <option value='__none__'>なし</option>
                {existingClubOptions.map((club) => (
                  <option key={club} value={club}>
                    {club}
                  </option>
                ))}
              </select>
            </div>
            <button
              type='button'
              className={styles.inlineEditButton}
              onClick={() => {
                setExistingSearchId('');
                setExistingFilterGrade('');
                setExistingFilterClass('');
                setExistingFilterAttendance('');
                setExistingFilterInitialRegistration('');
                setExistingFilterClub('');
              }}
            >
              リセット
            </button>
            <span className={styles.filterCount}>
              該当: {filteredExistingUsers.length} / {existingUsers.length} 件
            </span>
          </div>

          <p className={styles.tableScrollHint}>← 横にスクロールできます →</p>
          <div className={styles.tableWrapper}>
            <table className={styles.managementTable}>
              <thead>
                <tr>
                  <th>学年クラス番号 (ID)</th>
                  <th>初回登録</th>
                  <th>部活</th>
                  <th>最終ログイン</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {existingUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className={styles.info}>
                      登録済みの生徒アカウントはありません。
                    </td>
                  </tr>
                ) : (
                  filteredExistingUsers.map((user) => (
                    <tr key={user.studentId}>
                      <td>{user.studentId}</td>
                      <td className={styles.tableCellSub}>
                        {user.isInitialRegistrationComplete ? '済み' : '未登録'}
                      </td>
                      <td className={styles.tableCellSub}>
                        {!user.isInitialRegistrationComplete
                          ? '-'
                          : user.clubs.length > 0
                            ? user.clubs.join('、')
                            : 'なし'}
                      </td>
                      <td className={styles.tableCellSub}>
                        {user.lastSignIn
                          ? new Date(user.lastSignIn).toLocaleString()
                          : '未ログイン'}
                      </td>
                      <td>
                        <button
                          type='button'
                          className={styles.inlineEditButton}
                          onClick={() => openClubEditModal(user)}
                          disabled={
                            isGenerating ||
                            isSavingClubs ||
                            !user.isInitialRegistrationComplete
                          }
                        >
                          部活変更
                        </button>
                        <button
                          type='button'
                          className={styles.inlineEditButton}
                          onClick={() => openPasswordResetModal(user.studentId)}
                          disabled={isGenerating || isResettingPassword}
                        >
                          パスワードリセット
                        </button>
                        <button
                          type='button'
                          className={styles.inlineEditButton}
                          onClick={() =>
                            void handleAccountAction(user, 'resetUserData')
                          }
                          disabled={
                            isGenerating ||
                            accountActionEmail !== null ||
                            !user.isInitialRegistrationComplete
                          }
                        >
                          ユーザーデータを消去
                        </button>
                        <button
                          type='button'
                          className={styles.inlineEditButton}
                          onClick={() =>
                            void handleAccountAction(user, 'deleteUserAccount')
                          }
                          disabled={isGenerating || accountActionEmail !== null}
                        >
                          ユーザーを削除
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className={styles.noteText}>
            ※登録済みの全生徒アカウントを表示しています。
          </p>
        </NormalSection>
      )}

      {isGenerating && (
        <div className={styles.settingModalOverlay}>
          <LoadingSpinner
            message={`アカウントを生成・登録中です。5分以上時間がかかる場合があります。 (${progress.current} / ${progress.total}) ...`}
          />
        </div>
      )}

      {isLoadingUsers && (
        <div className={styles.settingModalOverlay}>
          <LoadingSpinner message='生徒アカウントを読み込み中です...' />
        </div>
      )}

      {passwordResetTarget && (
        <div
          className={styles.settingModalOverlay}
          role='presentation'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closePasswordResetModal();
            }
          }}
        >
          <form
            className={styles.settingModal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='student-password-reset-title'
            onSubmit={handleResetPassword}
            onClick={(event) => event.stopPropagation()}
          >
            <h3
              id='student-password-reset-title'
              className={styles.settingModalTitle}
            >
              ID: {passwordResetTarget.studentId} のパスワードをリセット
            </h3>
            <label className={styles.settingLabel}>
              <input
                type='radio'
                name='password-reset-mode'
                checked={passwordResetMode === 'random'}
                onChange={() => setPasswordResetMode('random')}
                disabled={isResettingPassword}
              />{' '}
              ランダムなパスワードを使う
            </label>
            {passwordResetMode === 'random' && (
              <input
                className={styles.authInput}
                type='text'
                value={passwordResetTarget.randomPassword}
                readOnly
                aria-label='生成されたパスワード'
              />
            )}
            <label className={styles.settingLabel}>
              <input
                type='radio'
                name='password-reset-mode'
                checked={passwordResetMode === 'manual'}
                onChange={() => setPasswordResetMode('manual')}
                disabled={isResettingPassword}
              />{' '}
              パスワードを入力する
            </label>
            {passwordResetMode === 'manual' && (
              <>
                <label
                  className={styles.authLabel}
                  htmlFor='student-reset-password'
                >
                  新しいパスワード
                </label>
                <input
                  id='student-reset-password'
                  className={styles.authInput}
                  type='text'
                  value={manualResetPassword}
                  onInput={(event) =>
                    setManualResetPassword(
                      (event.target as HTMLInputElement).value,
                    )
                  }
                  autoComplete='new-password'
                  minLength={8}
                  required
                />
                <label
                  className={styles.authLabel}
                  htmlFor='student-reset-password-confirm'
                >
                  新しいパスワード（確認）
                </label>
                <input
                  id='student-reset-password-confirm'
                  className={styles.authInput}
                  type='text'
                  value={manualResetPasswordConfirm}
                  onInput={(event) =>
                    setManualResetPasswordConfirm(
                      (event.target as HTMLInputElement).value,
                    )
                  }
                  autoComplete='new-password'
                  minLength={8}
                  required
                />
              </>
            )}
            {passwordResetError && (
              <p className={styles.authError} role='alert'>
                {passwordResetError}
              </p>
            )}
            <div className={styles.settingModalActions}>
              <button
                type='button'
                className={styles.settingModalCancel}
                onClick={closePasswordResetModal}
                disabled={isResettingPassword}
              >
                キャンセル
              </button>
              <button
                type='submit'
                className={styles.settingModalConfirm}
                disabled={isResettingPassword}
              >
                {isResettingPassword ? '変更中...' : '変更する'}
              </button>
            </div>
          </form>
        </div>
      )}

      {clubEditTarget && (
        <div
          className={styles.settingModalOverlay}
          role='presentation'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeClubEditModal();
            }
          }}
        >
          <form
            className={styles.settingModal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='student-club-edit-title'
            onSubmit={handleSaveClubs}
            onClick={(event) => event.stopPropagation()}
          >
            <h3
              id='student-club-edit-title'
              className={styles.settingModalTitle}
            >
              ID: {clubEditTarget.studentId} の部活を変更
            </h3>
            <p className={styles.noteText}>
              所属している部活をすべて選択してください。
            </p>
            {Array.from(new Set([...availableClubs, ...clubEditTarget.clubs]))
              .sort()
              .map((club) => (
                <label key={club} className={styles.settingLabel}>
                  <input
                    type='checkbox'
                    checked={editedClubs.includes(club)}
                    disabled={isSavingClubs}
                    onChange={(event) => {
                      const isChecked = event.currentTarget.checked;
                      setEditedClubs((clubs) =>
                        isChecked
                          ? [...clubs, club]
                          : clubs.filter(
                              (selectedClub) => selectedClub !== club,
                            ),
                      );
                    }}
                  />{' '}
                  {club}
                </label>
              ))}
            {availableClubs.length === 0 &&
              clubEditTarget.clubs.length === 0 && (
                <p className={styles.authError}>
                  部活候補を取得できませんでした。
                </p>
              )}
            {clubEditError && (
              <p className={styles.authError} role='alert'>
                {clubEditError}
              </p>
            )}
            <div className={styles.settingModalActions}>
              <button
                type='button'
                className={styles.settingModalCancel}
                onClick={closeClubEditModal}
                disabled={isSavingClubs}
              >
                キャンセル
              </button>
              <button
                type='submit'
                className={styles.settingModalConfirm}
                disabled={isSavingClubs}
              >
                {isSavingClubs ? '変更中...' : '変更する'}
              </button>
            </div>
          </form>
        </div>
      )}

      {passwordResetResult && (
        <div className={styles.settingModalOverlay} role='presentation'>
          <div
            className={styles.settingModal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='student-password-reset-complete-title'
          >
            <h3
              id='student-password-reset-complete-title'
              className={styles.settingModalTitle}
            >
              パスワードを変更しました
            </h3>
            <p>ID: {passwordResetResult.studentId} の新しいパスワードです。</p>
            <input
              className={styles.authInput}
              type='text'
              value={passwordResetResult.password}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
              aria-label='変更後のパスワード'
            />
            {passwordCopyMessage && (
              <p className={styles.authSuccess} role='status'>
                {passwordCopyMessage}
              </p>
            )}
            <div className={styles.settingModalActions}>
              <button
                type='button'
                className={styles.settingModalCancel}
                onClick={() => setPasswordResetResult(null)}
              >
                閉じる
              </button>
              <button
                type='button'
                className={styles.settingModalConfirm}
                onClick={copyResetPassword}
              >
                コピー
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StudentAccounts = () => {
  return (
    <AdminAuthLayout
      title='生徒アカウント管理'
      description='配布用IDとパスワードの一括生成を行います。'
    >
      <StudentAccountsContent />
    </AdminAuthLayout>
  );
};

export default StudentAccounts;
