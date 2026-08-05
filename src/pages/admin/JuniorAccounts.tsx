import { useEffect, useState } from 'preact/hooks';
import { useTitle } from '../../hooks/useTitle';
import { supabase } from '../../lib/supabase';
import {
  AdminAuthLayout,
  getSessionToken,
  readErrorMessage,
} from '../../layout/AdminAuthLayout';
import NormalSection from '../../components/ui/NormalSection';
import Alert from '../../components/ui/Alert';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import styles from './Settings.module.css';

type CsvAccount = {
  id: string;
  birthday: string;
};

type AuthCreateUser = {
  id: string;
  password: string;
};

type BulkCreateResponse = {
  created: number;
  skipped: number;
  errors: string[];
  failedUsers?: AuthCreateUser[];
  skippedUsers?: AuthCreateUser[];
};

type ExistingAuthUser = {
  studentId: string;
  email: string;
  juniorUsageType: number | null;
  applicationDay: string | null;
  lastSignIn?: string;
  createdAt: string;
};

type ExistingJuniorAccount = {
  id: string;
  birthday: string;
  email: string;
  createdAt: string;
  juniorUsageType: number | null;
  applicationDay: string | null;
  lastSignIn?: string;
};

const EXPECTED_CSV_HEADER = 'id,birthday';
const BATCH_SIZE = 20;
const MAX_RETRIES = 3;
const isBirthday = (value: string) => /^\d{8}$/.test(value);
const toCompositeId = (id: string, birthday: string) => `${id}-${birthday}`;

const formatJuniorUsageType = (usageType: number | null): string => {
  switch (usageType) {
    case 0:
      return '中学生と保護者（共通のチケット使用）';
    case 1:
      return '中学生と保護者（別々のチケット使用）';
    case 2:
      return '中学生のみ';
    case 3:
      return '保護者のみ';
    default:
      return '未設定';
  }
};

const formatApplicationDay = (applicationDay: string | null): string => {
  switch (applicationDay) {
    case 'class_day=day1&day2':
      return 'クラス公演';
    case 'gym_day=day1&day2':
      return '体育館公演';
    case 'admission_only':
      return '入場専用券のみ';
    default:
      return applicationDay ?? '未設定';
  }
};

const normalizeBirthday = (value: string): string | null => {
  const trimmed = value.trim();
  if (/^\d{8}$/.test(trimmed)) {
    return trimmed;
  }

  const parts = trimmed.split(/[/.-]/g);
  if (parts.length !== 3) {
    return null;
  }

  const [year, month, day] = parts;
  if (!/^\d{1,4}$/.test(year) || !/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day)) {
    return null;
  }

  return year.padStart(4, '0') + month.padStart(2, '0') + day.padStart(2, '0');
};

const parseCompositeId = (compositeId: string): { id: string; birthday: string } | null => {
  const match = compositeId.match(/^(.*)-(\d{8})$/);
  if (!match) {
    return null;
  }
  return { id: match[1], birthday: match[2] };
};

const parseCsvAccounts = (csvText: string) => {
  const normalized = csvText.replace(/^\uFEFF/, '').trim();
  if (!normalized) {
    return {
      accounts: [] as CsvAccount[],
      errors: ['CSVが空です。'],
    };
  }

  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return {
      accounts: [] as CsvAccount[],
      errors: ['CSVが空です。'],
    };
  }

  const header = lines[0].toLowerCase();
  if (header !== EXPECTED_CSV_HEADER) {
    return {
      accounts: [] as CsvAccount[],
      errors: [`ヘッダーは "${EXPECTED_CSV_HEADER}" にしてください。`],
    };
  }

  const accounts: CsvAccount[] = [];
  const errors: string[] = [];
  const seenIdBirthdayPairs = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i];
    const cells = line.split(',');

    if (cells.length !== 2) {
      errors.push(`${lineNo}行目: "id,birthday" 形式で入力してください。`);
      continue;
    }

    const id = cells[0].trim();
    const birthday = normalizeBirthday(cells[1].trim());

    if (!id) {
      errors.push(`${lineNo}行目: id が空です。`);
      continue;
    }

    if (id.includes('@')) {
      errors.push(
        `${lineNo}行目: id に @ は使えません。ローカル部のみ入力してください。`,
      );
      continue;
    }

    if (!birthday || !isBirthday(birthday)) {
      errors.push(
        `${lineNo}行目: birthday は8桁(YYYYMMDD)で入力してください。`,
      );
      continue;
    }

    const idBirthdayKey = `${id}|${birthday}`;
    if (seenIdBirthdayPairs.has(idBirthdayKey)) {
      errors.push(
        `${lineNo}行目: id "${id}" と birthday "${birthday}" の組み合わせが重複しています。`,
      );
      continue;
    }

    seenIdBirthdayPairs.add(idBirthdayKey);
    accounts.push({ id, birthday });
  }

  if (accounts.length === 0 && errors.length === 0) {
    errors.push('登録対象のデータがありません。');
  }

  return { accounts, errors };
};

const toFailedCsv = (failedUsers: CsvAccount[]) => {
  const rows = failedUsers.map((u) => `${u.id},${u.birthday}`);
  return [EXPECTED_CSV_HEADER, ...rows].join('\n');
};

const JuniorAccountContent = () => {
  useTitle('中学生アカウント管理 - 管理画面');

  const [manualId, setManualId] = useState('');
  const [manualBirthdayRaw, setManualBirthdayRaw] = useState('');
  const [manualResultMessage, setManualResultMessage] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [csvAccounts, setCsvAccounts] = useState<CsvAccount[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [resultMessage, setResultMessage] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);
  const [registerErrors, setRegisterErrors] = useState<string[]>([]);
  const [failedUsers, setFailedUsers] = useState<CsvAccount[]>([]);
  const [skippedAccounts, setSkippedAccounts] = useState<CsvAccount[]>([]);
  const [existingJuniorAccounts, setExistingJuniorAccounts] = useState<
    ExistingJuniorAccount[]
  >([]);
  const [isLoadingExistingUsers, setIsLoadingExistingUsers] = useState(false);
  const [accountActionEmail, setAccountActionEmail] = useState<string | null>(
    null,
  );

  const fetchExistingJuniorAccounts = async () => {
    setIsLoadingExistingUsers(true);
    try {
      const token = getSessionToken();
      const { data, error } = await supabase.functions.invoke<{
        users: ExistingAuthUser[];
      }>('admin-auth', {
        body: { action: 'getStudentUsers' },
        headers: { 'x-admin-session-token': token ?? '' },
      });

      if (error) {
        throw error;
      }

      const juniors = (data?.users ?? [])
        .map((user) => {
          const localPart = user.email?.split('@')[0] ?? '';
          const parsed = parseCompositeId(localPart);
          if (!parsed) {
            return null;
          }
          return {
            id: parsed.id,
            birthday: parsed.birthday,
            email: user.email,
            createdAt: user.createdAt,
            juniorUsageType: user.juniorUsageType,
            applicationDay: user.applicationDay,
            lastSignIn: user.lastSignIn,
          } as ExistingJuniorAccount;
        })
        .filter((user): user is ExistingJuniorAccount => Boolean(user))
        .sort((a, b) => a.id.localeCompare(b.id) || a.birthday.localeCompare(b.birthday));

      setExistingJuniorAccounts(juniors);
    } catch (err) {
      const errorMsg = await readErrorMessage(err);
      setResultMessage({
        text: `登録済みアカウント一覧の取得に失敗しました: ${errorMsg}`,
        type: 'error',
      });
    } finally {
      setIsLoadingExistingUsers(false);
    }
  };

  useEffect(() => {
    void fetchExistingJuniorAccounts();
  }, []);

  const handleAccountAction = async (
    account: ExistingJuniorAccount,
    action: 'resetUserData' | 'deleteUserAccount',
  ) => {
    const isDeletingAccount = action === 'deleteUserAccount';
    const confirmed = window.confirm(
      isDeletingAccount
        ? `ID: ${account.id} のチケット・ユーザーデータ・ログイン情報をすべて削除します。元に戻せません。続行しますか？`
        : `ID: ${account.id} の発券済みチケットとユーザーデータを削除します。ログイン情報は残ります。続行しますか？`,
    );
    if (!confirmed) {
      return;
    }
    setAccountActionEmail(account.email);
    setResultMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke<{
        deletedTickets: number;
      }>('admin-auth', {
        body: { action, accountType: 'junior', userEmail: account.email },
        headers: { 'x-admin-session-token': getSessionToken() ?? '' },
      });
      if (error) {
        throw error;
      }
      await fetchExistingJuniorAccounts();
      setResultMessage({
        type: 'success',
        text: isDeletingAccount
          ? `ID: ${account.id} のユーザーを削除しました。`
          : `ID: ${account.id} のユーザーデータを消去しました（チケット ${data?.deletedTickets ?? 0} 件）。`,
      });
    } catch (err) {
      setResultMessage({
        type: 'error',
        text: `操作に失敗しました: ${await readErrorMessage(err)}`,
      });
    } finally {
      setAccountActionEmail(null);
    }
  };

  const handleManualRegister = async () => {
    setManualResultMessage(null);

    const id = manualId.trim();
    const birthday = normalizeBirthday(manualBirthdayRaw);

    if (!id) {
      setManualResultMessage({ text: 'IDを入力してください。', type: 'error' });
      return;
    }

    if (id.includes('@')) {
      setManualResultMessage({
        text: 'IDに @ は使えません（ローカル部のみ入力してください）。',
        type: 'error',
      });
      return;
    }

    if (!birthday || !isBirthday(birthday)) {
      setManualResultMessage({
        text: '誕生日は8桁(YYYYMMDD)の整数にするか、区切り文字で入力してください。',
        type: 'error',
      });
      return;
    }

    if (
      !window.confirm(
        `中学生アカウントを登録しますか？\nID: ${id}\n誕生日: ${birthday}`,
      )
    ) {
      return;
    }

    setIsSubmitting(true);
    setProgress({ current: 0, total: 1 });

    try {
      const token = getSessionToken();
      const compositeId = toCompositeId(id, birthday);
      const users: AuthCreateUser[] = [{ id: compositeId, password: birthday }];

      const { data, error } = await supabase.functions.invoke<BulkCreateResponse>(
        'admin-auth',
        {
          body: { action: 'bulkCreateUsers', users },
          headers: { 'x-admin-session-token': token ?? '' },
        },
      );

      if (error) {
        throw error;
      }

      setProgress({ current: 1, total: 1 });

      const didCreate = (data?.created ?? 0) > 0;
      const didSkip = (data?.skipped ?? 0) > 0;
      const failed = data?.failedUsers ?? [];
      const errors = data?.errors ?? [];
      const skippedUsers = data?.skippedUsers ?? [];

      if (failed.length > 0 || errors.length > 0) {
        setManualResultMessage({ text: '登録に失敗しました。', type: 'error' });
        return;
      }

      if (didSkip || skippedUsers.length > 0) {
        setManualResultMessage({
          text: '既に登録済みのため、既存扱い（skipped）になりました。',
          type: 'success',
        });
      } else if (didCreate) {
        setManualResultMessage({ text: '登録しました。', type: 'success' });
        setManualId('');
        setManualBirthdayRaw('');
      } else {
        setManualResultMessage({
          text: '登録結果を確認できませんでした。時間をおいて再度お試しください。',
          type: 'error',
        });
      }

      void fetchExistingJuniorAccounts();
    } catch (err) {
      const errorMsg = await readErrorMessage(err);
      setManualResultMessage({
        text: `登録に失敗しました: ${errorMsg}`,
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFileChange = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];

    setResultMessage(null);
    setRegisterErrors([]);
    setFailedUsers([]);
    setSkippedAccounts([]);

    if (!file) {
      setSelectedFileName(null);
      setCsvAccounts([]);
      setParseErrors([]);
      return;
    }

    setSelectedFileName(file.name);
    const content = await file.text();
    const { accounts, errors } = parseCsvAccounts(content);
    setCsvAccounts(accounts);
    setParseErrors(errors);
  };

  const downloadFailedCsv = () => {
    if (failedUsers.length === 0) {
      return;
    }

    const content = toFailedCsv(failedUsers);
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `junior_accounts_failed_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleBulkRegister = async () => {
    if (csvAccounts.length === 0 || parseErrors.length > 0) {
      return;
    }

    if (
      !window.confirm(
        `${csvAccounts.length}件の中学生アカウントをAuthへ登録します。実行しますか？`,
      )
    ) {
      return;
    }

    setIsSubmitting(true);
    setResultMessage(null);
    setRegisterErrors([]);
    setFailedUsers([]);
    setSkippedAccounts([]);
    setProgress({ current: 0, total: csvAccounts.length });

    const sourceByCompositeId = new Map(
      csvAccounts.map((u) => [toCompositeId(u.id, u.birthday), u]),
    );
    const finalErrorsMap = new Map<string, string>();
    const skippedCompositeIdSet = new Set<string>();
    let totalCreated = 0;
    let totalSkipped = 0;
    let resolvedCount = 0;
    let currentQueue: AuthCreateUser[] = csvAccounts.map((account) => ({
      id: toCompositeId(account.id, account.birthday),
      password: account.birthday,
    }));
    let retryAttempt = 0;

    try {
      const token = getSessionToken();

      while (currentQueue.length > 0 && retryAttempt <= MAX_RETRIES) {
        const nextQueue: AuthCreateUser[] = [];
        const currentBatchSize = retryAttempt > 0 ? 10 : BATCH_SIZE;

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
                data.failedUsers?.map((u) => u.id) ?? [],
              );
              batch.forEach((u) => {
                if (!failedIds.has(u.id)) {
                  finalErrorsMap.delete(u.id);
                }
              });

              data.errors?.forEach((errorText) => {
                const id = errorText.split(':')[0]?.trim();
                if (id) {
                  finalErrorsMap.set(id, errorText);
                }
              });

              if (data.failedUsers) {
                nextQueue.push(...data.failedUsers);
              }

              data.skippedUsers?.forEach((user) => {
                skippedCompositeIdSet.add(user.id);
              });
            }
          } catch {
            batch.forEach((u) => {
              finalErrorsMap.set(u.id, `${u.id}: 通信エラーまたはタイムアウト`);
            });
            nextQueue.push(...batch);
          }

          setProgress({
            current: Math.min(resolvedCount, csvAccounts.length),
            total: csvAccounts.length,
          });
        }

        currentQueue = nextQueue;
        retryAttempt++;
        if (currentQueue.length > 0 && retryAttempt <= MAX_RETRIES) {
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * retryAttempt),
          );
        }
      }

      if (currentQueue.length > 0) {
        setProgress({ current: csvAccounts.length, total: csvAccounts.length });
      }

      const errors = Array.from(finalErrorsMap.values());
      const finalFailedUsers = Array.from(finalErrorsMap.keys())
        .map((id) => sourceByCompositeId.get(id))
        .filter((u): u is CsvAccount => Boolean(u));
      const finalSkippedUsers = Array.from(skippedCompositeIdSet)
        .map((id) => sourceByCompositeId.get(id))
        .filter((u): u is CsvAccount => Boolean(u));

      setRegisterErrors(errors);
      setFailedUsers(finalFailedUsers);
      setSkippedAccounts(finalSkippedUsers);
      setResultMessage({
        text: `登録完了: 新規 ${totalCreated}件 / 既存 ${totalSkipped}件${errors.length > 0 ? ` / 失敗 ${errors.length}件` : ''}`,
        type: 'success',
      });
      void fetchExistingJuniorAccounts();
    } catch (err) {
      const errorMsg = await readErrorMessage(err);
      setResultMessage({
        text: `登録に失敗しました: ${errorMsg}`,
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.container}>
      <NormalSection>
        <h2>手動登録</h2>
        <p className={styles.noteText}>
          IDと誕生日を入力して、1件だけAuthへ登録します。`public.users`
          には行を追加しません。
        </p>
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label className={styles.settingLabel} htmlFor='junior-manual-id'>
              ID
            </label>
            <input
              id='junior-manual-id'
              type='text'
              className={`${styles.fieldControl} ${styles.juniorRegisterInput}`}
              value={manualId}
              onInput={(e) => setManualId((e.target as HTMLInputElement).value)}
              placeholder='例: abc123'
              disabled={isSubmitting}
            />
          </div>
          <div className={styles.field}>
            <label
              className={styles.settingLabel}
              htmlFor='junior-manual-birthday'
            >
              誕生日
            </label>
            <input
              id='junior-manual-birthday'
              type='text'
              className={`${styles.fieldControl} ${styles.juniorRegisterInput}`}
              value={manualBirthdayRaw}
              onInput={(e) =>
                setManualBirthdayRaw((e.target as HTMLInputElement).value)
              }
              placeholder='YYYYMMDD または YYYY/MM/DD'
              disabled={isSubmitting}
            />
          </div>
        </div>
        <div className={styles.saveButtonContainer}>
          <button
            type='button'
            className={`${styles.authButton} ${styles.saveButtonPrimary}`}
            onClick={() => void handleManualRegister()}
            disabled={isSubmitting}
          >
            {isSubmitting ? '登録中...' : '登録'}
          </button>
        </div>
        {manualResultMessage ? (
          <p
            className={
              manualResultMessage.type === 'success'
                ? styles.authSuccess
                : styles.authError
            }
          >
            {manualResultMessage.text}
          </p>
        ) : null}
      </NormalSection>

      <NormalSection>
        <h2>CSV一括登録</h2>
        <p className={styles.noteText}>
          CSVから中学生アカウントをAuthへ一括登録します。`public.users`
          には行を追加しません。
        </p>
        <Alert type='info'>
          CSV形式は `id,birthday` です。1行目に必ずヘッダー `id,birthday`
          を入れてください。 birthday
          は8桁(YYYYMMDD)の整数にするか、スラッシュ(/)、ハイフン(-)、ピリオド(.)のいずれかで区切ってください。
        </Alert>

        <div className={styles.field}>
          <label className={styles.settingLabel} htmlFor='junior-accounts-csv'>
            CSVファイル
          </label>
          <input
            id='junior-accounts-csv'
            type='file'
            accept='.csv,text/csv'
            onChange={(e) => void handleFileChange(e)}
            className={styles.fieldControl}
          />
          {selectedFileName ? (
            <p className={styles.noteText}>選択中: {selectedFileName}</p>
          ) : null}
        </div>

        {parseErrors.length > 0 ? (
          <div className={styles.authError}>
            <p>CSVの検証でエラーが見つかりました。</p>
            <ul>
              {parseErrors.slice(0, 10).map((error, index) => (
                <li key={`${error}-${index}`}>{error}</li>
              ))}
            </ul>
            {parseErrors.length > 10 ? (
              <p>...他 {parseErrors.length - 10} 件</p>
            ) : null}
          </div>
        ) : null}

        <div className={styles.saveButtonContainer}>
          <button
            type='button'
            className={`${styles.authButton} ${styles.saveButtonPrimary}`}
            onClick={() => void handleBulkRegister()}
            disabled={
              isSubmitting || csvAccounts.length === 0 || parseErrors.length > 0
            }
          >
            {isSubmitting
              ? '登録中...'
              : `Authに一括登録 (${csvAccounts.length}件)`}
          </button>

          {failedUsers.length > 0 && (
            <button
              type='button'
              className={`${styles.authButton} ${styles.juniorSaveButtonSecondary}`}
              onClick={downloadFailedCsv}
            >
              失敗分CSVを保存 ({failedUsers.length}件)
            </button>
          )}
        </div>

        {resultMessage ? (
          <p
            className={
              resultMessage.type === 'success'
                ? styles.authSuccess
                : styles.authError
            }
          >
            {resultMessage.text}
          </p>
        ) : null}

        {registerErrors.length > 0 ? (
          <div className={styles.authError}>
            <p>登録時エラー:</p>
            <ul>
              {registerErrors.slice(0, 10).map((error, index) => (
                <li key={`${error}-${index}`}>{error}</li>
              ))}
            </ul>
            {registerErrors.length > 10 ? (
              <p>...他 {registerErrors.length - 10} 件</p>
            ) : null}
          </div>
        ) : null}

        {skippedAccounts.length > 0 ? (
          <div>
            <h3>既存扱い（skipped）になったアカウント</h3>
            <p className={styles.tableScrollHint}>
              ← 横にスクロールできます →
            </p>
            <div className={styles.tableWrapper}>
              <table className={styles.managementTable}>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>誕生日</th>
                  </tr>
                </thead>
                <tbody>
                  {skippedAccounts.map((account) => (
                    <tr key={`${account.id}-${account.birthday}`}>
                      <td>{account.id}</td>
                      <td>{account.birthday}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </NormalSection>

      {csvAccounts.length > 0 ? (
        <NormalSection>
          <h2>読み込みプレビュー</h2>
          <p className={styles.noteText}>
            先頭100件を表示しています（合計 {csvAccounts.length} 件）
          </p>
          <p className={styles.tableScrollHint}>
            ← 横にスクロールできます →
          </p>
          <div className={styles.tableWrapper}>
            <table className={styles.managementTable}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>誕生日</th>
                </tr>
              </thead>
              <tbody>
                {csvAccounts.slice(0, 100).map((account) => (
                  <tr key={account.id}>
                    <td>{account.id}</td>
                    <td>
                      <code className={styles.codePassword}>
                        {account.birthday}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </NormalSection>
      ) : null}

      <NormalSection>
        <div className={styles.headerRow}>
          <h2>登録済み中学生アカウント</h2>
          <button
            type='button'
            className={styles.inlineEditButton}
            onClick={() => void fetchExistingJuniorAccounts()}
            disabled={isLoadingExistingUsers}
          >
            {isLoadingExistingUsers ? '更新中...' : '一覧を更新'}
          </button>
        </div>
        <p className={styles.noteText}>
          既存扱い（スキップ）になったアカウントもここに表示されます。
        </p>
        <p className={styles.tableScrollHint}>
          ← 横にスクロールできます →
        </p>
        <div className={styles.tableWrapper}>
          <table className={styles.managementTable}>
            <thead>
              <tr>
                <th>ID</th>
                <th>誕生日</th>
                <th>利用形態</th>
                <th>申込内容</th>
                <th>最終ログイン</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {existingJuniorAccounts.length === 0 ? (
                <tr>
                  <td colSpan={6} className={styles.info}>
                    登録済みの中学生アカウントはありません。
                  </td>
                </tr>
              ) : (
                existingJuniorAccounts.map((account) => (
                  <tr key={account.email}>
                    <td>{account.id}</td>
                    <td>{account.birthday}</td>
                    <td>{formatJuniorUsageType(account.juniorUsageType)}</td>
                    <td>{formatApplicationDay(account.applicationDay)}</td>
                    <td className={styles.tableCellSub}>
                      {account.lastSignIn
                        ? new Date(account.lastSignIn).toLocaleString()
                        : '未ログイン'}
                    </td>
                    <td>
                      <button
                        type='button'
                        className={styles.inlineEditButton}
                        onClick={() =>
                          void handleAccountAction(account, 'resetUserData')
                        }
                        disabled={accountActionEmail !== null}
                      >
                        ユーザーデータを消去
                      </button>
                      <button
                        type='button'
                        className={styles.inlineEditButton}
                        onClick={() =>
                          void handleAccountAction(account, 'deleteUserAccount')
                        }
                        disabled={accountActionEmail !== null}
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
      </NormalSection>

      {isSubmitting ? (
        <div className={styles.settingModalOverlay}>
          <LoadingSpinner
            message={`アカウントを登録中です... (${progress.current} / ${progress.total})`}
          />
        </div>
      ) : null}
    </div>
  );
};

const JuniorAccounts = () => {
  return (
    <AdminAuthLayout
      title='中学生アカウント管理'
      description='csvファイルから、中学生アカウントのIDと誕生日を一括でAuthへ登録します。'
    >
      <JuniorAccountContent />
    </AdminAuthLayout>
  );
};

export default JuniorAccounts;
