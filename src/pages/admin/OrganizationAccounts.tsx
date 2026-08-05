import { useEffect, useState } from 'preact/hooks';
import Alert from '../../components/ui/Alert';
import NormalSection from '../../components/ui/NormalSection';
import { useTitle } from '../../hooks/useTitle';
import { supabase } from '../../lib/supabase';
import {
  AdminAuthLayout,
  getSessionToken,
  readErrorMessage,
} from '../../layout/AdminAuthLayout';
import styles from './Settings.module.css';

type Kind = 'class' | 'gym' | 'exhibition';
type Account = {
  id: string;
  username: string;
  class_performance_id: number | null;
  gym_performance_id: number | null;
  exhibition_club_id: number | null;
};
type Performance = {
  id: number;
  class_name?: string;
  title?: string | null;
  group_name?: string;
  round_name?: string | null;
};

const PASSWORD_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const createPassword = (length = 10) => {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(
    bytes,
    (value) => PASSWORD_ALPHABET[value % PASSWORD_ALPHABET.length],
  ).join('');
};

const downloadCredentials = (
  rows: { username: string; password: string; group: string }[],
) => {
  const csv = [
    ['ID', 'パスワード', '団体'],
    ...rows.map((row) => [row.username, row.password, row.group]),
  ]
    .map((row) =>
      row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(','),
    )
    .join('\r\n');
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `organization-admin-accounts-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
};

const defaultUsername = (kind: Kind, performance: Performance) => {
  if (kind === 'class') {
    return performance.class_name ?? `class-${performance.id}`;
  }
  if (kind === 'exhibition') {
    return `exhibition-${performance.id}`;
  }
  const known: Record<string, string> = {
    ダンス部: 'dance',
    '軽音楽部 1,2年': 'keion-12',
    '軽音楽部 3年': 'keion-3',
    青フィル: 'aophil',
  };
  return `${known[performance.group_name ?? ''] ?? 'club'}-${performance.id}`;
};

const OrganizationAccountsContent = () => {
  useTitle('クラス・部活管理者 - 管理画面');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [classes, setClasses] = useState<Performance[]>([]);
  const [gyms, setGyms] = useState<Performance[]>([]);
  const [exhibitions, setExhibitions] = useState<Performance[]>([]);
  const [editTarget, setEditTarget] = useState<Account | null>(null);
  const [editMode, setEditMode] = useState<'id' | 'password' | 'delete' | null>(
    null,
  );
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const load = async () => {
    const { data, error } = await supabase.functions.invoke('admin-auth', {
      body: { action: 'getOrganizationAdmins' },
      headers: { 'x-admin-session-token': getSessionToken() ?? '' },
    });
    if (error) {
      throw error;
    }
    setAccounts(data?.admins ?? []);
    setClasses(data?.classes ?? []);
    setGyms(data?.gyms ?? []);
    setExhibitions(data?.exhibitions ?? []);
  };

  useEffect(() => {
    void load().catch(async (error) =>
      setMessage({
        type: 'error',
        text: `一覧の取得に失敗しました。${await readErrorMessage(error)}`,
      }),
    );
  }, []);

  const bulkCreate = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const classIds = new Set(
      accounts
        .map((account) => account.class_performance_id)
        .filter((id): id is number => id !== null),
    );
    const gymIds = new Set(
      accounts
        .map((account) => account.gym_performance_id)
        .filter((id): id is number => id !== null),
    );
    const exhibitionIds = new Set(
      accounts
        .map((account) => account.exhibition_club_id)
        .filter((id): id is number => id !== null),
    );
    const assignedGymGroups = new Set(
      accounts
        .filter((account) => account.gym_performance_id !== null)
        .map(
          (account) =>
            gyms.find((item) => item.id === account.gym_performance_id)
              ?.group_name,
        )
        .filter((name): name is string => Boolean(name)),
    );
    const includedGymGroups = new Set<string>();
    const admins = [
      ...classes
        .filter((item) => !classIds.has(item.id))
        .map((item) => ({
          kind: 'class' as const,
          performanceId: item.id,
          username: defaultUsername('class', item),
          password: createPassword(),
          group: `${item.class_name ?? '不明'}：${item.title ?? '無題の公演'}`,
        })),
      ...gyms
        .filter((item) => {
          const group = item.group_name ?? '';
          if (gymIds.has(item.id) || assignedGymGroups.has(group) || includedGymGroups.has(group)) {
            return false;
          }
          includedGymGroups.add(group);
          return true;
        })
        .map((item) => ({
          kind: 'gym' as const,
          performanceId: item.id,
          username: defaultUsername('gym', item),
          password: createPassword(),
          group: `${item.group_name ?? '不明'}：${item.round_name ?? ''}`,
        })),
      ...exhibitions
        .filter((item) => !exhibitionIds.has(item.id))
        .map((item) => ({
          kind: 'exhibition' as const,
          performanceId: item.id,
          username: defaultUsername('exhibition', item),
          password: createPassword(),
          group: item.group_name ?? '不明',
        })),
    ];
    if (!admins.length) {
      setMessage({ type: 'success', text: '未作成のアカウントはありません。' });
      setBusy(false);
      return;
    }
    try {
      const createdAdmins: typeof admins = [];
      let createdCount = 0;
      for (let index = 0; index < admins.length; index += 5) {
        const batch = admins.slice(index, index + 5);
        const { data, error } = await supabase.functions.invoke('admin-auth', {
          body: {
            action: 'bulkCreateOrganizationAdmins',
            organizationAdmins: batch,
          },
          headers: { 'x-admin-session-token': getSessionToken() ?? '' },
        });
        if (error) {
          if (createdAdmins.length > 0) {
            downloadCredentials(createdAdmins);
          }
          throw error;
        }
        const skipped = new Set<string>(data?.skipped ?? []);
        createdAdmins.push(
          ...batch.filter((admin) => !skipped.has(admin.username)),
        );
        createdCount += data?.created ?? 0;
      }
      downloadCredentials(createdAdmins);
      await load();
      setMessage({
        type: 'success',
        text: `${createdCount}件のアカウントを作成し、ID・パスワードのCSVをダウンロードしました。`,
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text: `一括作成に失敗しました。${await readErrorMessage(error)}`,
      });
    } finally {
      setBusy(false);
    }
  };

  const changeUsername = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (!editTarget) {
        throw new Error('対象アカウントを選択してください。');
      }
      const { data, error } = await supabase.functions.invoke('admin-auth', {
        body: {
          action: 'changeOrganizationAdminUsername',
          organizationAdminId: editTarget.id,
          organizationUsername: newUsername,
        },
        headers: { 'x-admin-session-token': getSessionToken() ?? '' },
      });
      if (error) {
        throw error;
      }
      if (!data?.changed) {
        throw new Error('IDの変更に失敗しました。');
      }
      await load();
      setNewUsername('');
      setEditMode(null);
      setEditTarget(null);
      setMessage({
        type: 'success',
        text: 'IDを変更しました。既存のログインは解除されています。',
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text: `IDの変更に失敗しました。${await readErrorMessage(error)}`,
      });
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (!editTarget) {
        throw new Error('対象アカウントを選択してください。');
      }
      const { data, error } = await supabase.functions.invoke('admin-auth', {
        body: {
          action: 'changeOrganizationAdminPassword',
          organizationAdminId: editTarget.id,
          organizationPassword: newPassword,
        },
        headers: { 'x-admin-session-token': getSessionToken() ?? '' },
      });
      if (error) {
        throw error;
      }
      if (!data?.changed) {
        throw new Error('パスワードの変更に失敗しました。');
      }
      setNewPassword('');
      setEditMode(null);
      setEditTarget(null);
      setMessage({
        type: 'success',
        text: 'パスワードを変更しました。既存のログインは解除されています。',
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text: `パスワード変更に失敗しました。${await readErrorMessage(error)}`,
      });
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    if (!editTarget) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('admin-auth', {
        body: {
          action: 'deleteOrganizationAdmin',
          organizationAdminId: editTarget.id,
        },
        headers: { 'x-admin-session-token': getSessionToken() ?? '' },
      });
      if (error) {
        throw error;
      }
      if (!data?.deleted) {
        throw new Error('アカウントの削除に失敗しました。');
      }
      await load();
      setEditMode(null);
      setEditTarget(null);
      setMessage({
        type: 'success',
        text: '団体管理者アカウントを削除しました。',
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text: `アカウントの削除に失敗しました。${await readErrorMessage(error)}`,
      });
    } finally {
      setBusy(false);
    }
  };

  const label = (account: Account) => {
    const performance =
      account.class_performance_id !== null
        ? classes.find((item) => item.id === account.class_performance_id)
        : account.gym_performance_id !== null
          ? gyms.find((item) => item.id === account.gym_performance_id)
          : exhibitions.find((item) => item.id === account.exhibition_club_id);
    return account.class_performance_id !== null
      ? `${performance?.class_name ?? '不明'}：${performance?.title ?? '無題の公演'}`
      : performance?.group_name ?? '不明';
  };

  return (
    <div>
      {message && (
        <Alert type={message.type === 'error' ? 'error' : 'info'}>
          {message.text}
        </Alert>
      )}
      <NormalSection>
        <h2>未作成アカウントを一括作成</h2>
        <p className={styles.settingHint}>
          アカウントごとにランダムなパスワードを設定し、作成後にCSVをダウンロードします。
        </p>
        <form className={styles.organizationForm} onSubmit={bulkCreate}>
          <button className={styles.authButton} disabled={busy}>
            {busy ? '作成中...' : '未作成アカウントを一括作成してCSVを出力'}
          </button>
        </form>
      </NormalSection>
      <NormalSection>
        <h2>アカウント一覧</h2>
        <p className={styles.tableScrollHint}>
          ← 横にスクロールできます →
        </p>
        <div className={styles.organizationTableWrap}>
          <table className={styles.organizationAccountTable}>
            <thead>
              <tr>
                <th>ID</th>
                <th>団体</th>
                <th>種別</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>{account.username}</td>
                  <td>{label(account)}</td>
                  <td>
                    {account.class_performance_id !== null
                      ? 'クラス'
                      : account.exhibition_club_id !== null ? '展示部活' : '部活'}
                  </td>
                  <td>
                    <div className={styles.organizationActions}>
                      <button
                        type='button'
                        className={styles.inlineEditButton}
                        onClick={() => {
                          setEditTarget(account);
                          setEditMode('id');
                          setNewUsername(account.username);
                        }}
                      >
                        IDを変更
                      </button>
                      <button
                        type='button'
                        className={styles.inlineEditButton}
                        onClick={() => {
                          setEditTarget(account);
                          setEditMode('password');
                          setNewPassword('');
                        }}
                      >
                        パスワードを変更
                      </button>
                      <button
                        type='button'
                        className={`${styles.inlineEditButton} ${styles.organizationDeleteButton}`}
                        onClick={() => {
                          setEditTarget(account);
                          setEditMode('delete');
                        }}
                      >
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </NormalSection>
      {editTarget && editMode && (
        <div
          className={styles.settingModalOverlay}
          role='presentation'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) {
              setEditTarget(null);
              setEditMode(null);
            }
          }}
        >
          <div
            className={styles.settingModal}
            role='dialog'
            aria-modal='true'
            onClick={(event) => event.stopPropagation()}
          >
            <h3>
              {editMode === 'id'
                ? 'IDを変更'
                : editMode === 'password'
                  ? 'パスワードを変更'
                  : 'アカウントを削除'}
              ：{editTarget.username}
            </h3>
            {editMode === 'delete' ? (
              <>
                <p>
                  この団体管理者アカウントを削除します。元に戻すことはできません。
                </p>
                <div className={styles.settingModalActions}>
                  <button
                    type='button'
                    className={styles.settingModalCancel}
                    onClick={() => {
                      setEditTarget(null);
                      setEditMode(null);
                    }}
                    disabled={busy}
                  >
                    キャンセル
                  </button>
                  <button
                    type='button'
                    className={styles.settingModalConfirmDanger}
                    onClick={() => void deleteAccount()}
                    disabled={busy}
                  >
                    {busy ? '削除中...' : '削除する'}
                  </button>
                </div>
              </>
            ) : (
              <form
                onSubmit={editMode === 'id' ? changeUsername : changePassword}
              >
                {editMode === 'id' ? (
                  <label className={styles.authLabel}>
                    新しいID
                    <input
                      className={styles.authInput}
                      value={newUsername}
                      onInput={(event) =>
                        setNewUsername((event.target as HTMLInputElement).value)
                      }
                      pattern='[A-Za-z0-9._-]{3,100}'
                      required
                    />
                  </label>
                ) : (
                  <label className={styles.authLabel}>
                    新しいパスワード
                    <input
                      type='password'
                      className={styles.authInput}
                      value={newPassword}
                      onInput={(event) =>
                        setNewPassword((event.target as HTMLInputElement).value)
                      }
                      minLength={8}
                      autoComplete='new-password'
                      required
                    />
                  </label>
                )}
                <div className={styles.settingModalActions}>
                  <button
                    type='button'
                    className={styles.settingModalCancel}
                    onClick={() => {
                      setEditTarget(null);
                      setEditMode(null);
                    }}
                    disabled={busy}
                  >
                    キャンセル
                  </button>
                  <button type='submit' disabled={busy}>
                    {busy ? '変更中...' : '変更する'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const OrganizationAccounts = () => (
  <AdminAuthLayout
    title='クラス・部活管理者'
    description='団体管理者アカウントの作成・一覧・ID・パスワード変更を行います。'
  >
    <OrganizationAccountsContent />
  </AdminAuthLayout>
);
export default OrganizationAccounts;
