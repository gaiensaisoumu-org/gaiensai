import { useEffect, useMemo, useState } from 'preact/hooks';
import Alert from '../../components/ui/Alert';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import NormalSection from '../../components/ui/NormalSection';
import Switch from '../../components/ui/Switch';
import { getPerformanceImageUrl, supabase } from '../../lib/supabase';
import { readErrorMessage } from '../../layout/AdminAuthLayout';
import { useTitle } from '../../hooks/useTitle';
import styles from './OrganizationAdmin.module.css';
import subPageStyles from '../../styles/sub-pages.module.css';

const TOKEN_KEY = 'organization_admin_session_v1';
const sessionHeaders = () => ({
  'x-organization-admin-session-token': localStorage.getItem(TOKEN_KEY) ?? '',
});

type TicketLink = {
  id: string;
  round_id?: number;
  round_name: string;
  tickets: {
    id: string;
    code: string;
    created_at: string;
    users: { affiliation: number | null } | null;
  };
};
type Dashboard = {
  username: string;
  kind: 'class' | 'gym';
  performance: Record<string, unknown>;
  tickets: TicketLink[];
};
type MessageScope = 'performance' | 'image' | 'ticketSettings' | 'password';

const csvCell = (value: unknown) =>
  `"${String(value ?? '').replaceAll('"', '""')}"`;
const downloadCsv = (tickets: TicketLink[]) => {
  const lines = [
    ['チケットコード', '公演回', '学年・クラス・番号', '発行日時'],
    ...tickets.map(({ tickets: ticket, round_name }) => [
      ticket.code,
      round_name,
      formatAffiliation(ticket.users?.affiliation),
      new Date(ticket.created_at).toLocaleString('ja-JP'),
    ]),
  ].map((row) => row.map(csvCell).join(','));
  const blob = new Blob(['\uFEFF', lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `ticket-roster-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

const formatAffiliation = (affiliation: number | null | undefined) => {
  if (!affiliation || affiliation < 10000) {
    return '—';
  }
  return `${Math.floor(affiliation / 10000)}年${Math.floor(
    (affiliation % 10000) / 100,
  )}組${affiliation % 100}番`;
};

const OrganizationAdmin = () => {
  useTitle('クラス・部活管理');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [messageScope, setMessageScope] = useState<MessageScope | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isAccepting, setIsAccepting] = useState(false);
  const [capacity, setCapacity] = useState('');
  const [juniorCapacity, setJuniorCapacity] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [roundFilter, setRoundFilter] = useState('all');
  const [showCapacityModal, setShowCapacityModal] = useState(false);
  const [showDeploymentNotice, setShowDeploymentNotice] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageVersion, setImageVersion] = useState(0);
  const [draftCapacity, setDraftCapacity] = useState('');
  const [draftJuniorCapacity, setDraftJuniorCapacity] = useState('');

  const load = async () => {
    const { data, error: invokeError } = await supabase.functions.invoke(
      'organization-admin',
      {
        body: { action: 'getDashboard' },
        headers: sessionHeaders(),
      },
    );
    if (invokeError) {
      throw invokeError;
    }
    const next = data as Dashboard;
    setDashboard(next);
    setTitle(String(next.performance.title ?? ''));
    setDescription(String(next.performance.description ?? ''));
    setIsAccepting(Boolean(next.performance.is_accepting));
    setCapacity(
      String(
        next.kind === 'class'
          ? (next.performance.total_capacity ?? '')
          : (next.performance.capacity ?? ''),
      ),
    );
    setJuniorCapacity(String(next.performance.junior_capacity ?? ''));
  };

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      setChecking(false);
      return;
    }
    load()
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setChecking(false));
  }, []);

  const login = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        'organization-admin',
        { body: { action: 'login', username, password } },
      );
      if (invokeError) {
        throw invokeError;
      }
      if (!data?.authenticated || typeof data.sessionToken !== 'string') {
        setError('ユーザー名またはパスワードが正しくありません。');
        return;
      }
      localStorage.setItem(TOKEN_KEY, data.sessionToken);
      setPassword('');
      await load();
    } catch (cause) {
      setError(await readErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const save = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setMessageScope('performance');
    setError(null);
    setNotice(null);
    try {
      const { error: invokeError } = await supabase.functions.invoke(
        'organization-admin',
        {
          body: {
            action: 'updatePerformance',
            title,
            description,
            isAccepting,
          },
          headers: sessionHeaders(),
        },
      );
      if (invokeError) {
        throw invokeError;
      }
      await load();
      setNotice('公演情報を更新しました。');
      setShowDeploymentNotice(true);
    } catch (cause) {
      setError(await readErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const uploadImage = async (event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }
    setError(null);
    setNotice(null);
    setMessageScope('image');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('JPEG・PNG・WebP形式の画像を選択してください。');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('画像ファイルは5MB以下にしてください。');
      return;
    }
    setIsUploadingImage(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('画像の読み込みに失敗しました。'));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.split(',')[1];
      const { error: invokeError } = await supabase.functions.invoke(
        'organization-admin',
        {
          body: { action: 'uploadImage', contentType: file.type, base64 },
          headers: sessionHeaders(),
        },
      );
      if (invokeError) {
        throw invokeError;
      }
      await load();
      setImageVersion(Date.now());
      setNotice('公演画像を更新しました。');
      setShowDeploymentNotice(true);
    } catch (cause) {
      setError(await readErrorMessage(cause));
    } finally {
      setIsUploadingImage(false);
      (event.target as HTMLInputElement).value = '';
    }
  };

  const changePassword = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setMessageScope('password');
    setError(null);
    setNotice(null);
    try {
      if (newPassword.length < 8) {
        throw new Error('新しいパスワードは8文字以上で入力してください。');
      }
      if (newPassword !== confirmPassword) {
        throw new Error('新しいパスワードと確認用パスワードが一致しません。');
      }
      const { error: invokeError } = await supabase.functions.invoke(
        'organization-admin',
        {
          body: { action: 'changePassword', currentPassword, newPassword },
          headers: sessionHeaders(),
        },
      );
      if (invokeError) {
        throw invokeError;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice('パスワードを変更しました。');
    } catch (cause) {
      setError(await readErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const saveTicketSettings = async (
    nextIsAccepting: boolean,
    nextCapacity = capacity,
    nextJuniorCapacity = juniorCapacity,
  ) => {
    setBusy(true);
    setMessageScope('ticketSettings');
    setError(null);
    setNotice(null);
    try {
      const capacityValue = Number(nextCapacity);
      const juniorCapacityValue = Number(nextJuniorCapacity);
      if (!Number.isInteger(capacityValue) || capacityValue < 1) {
        throw new Error('定員は1人以上の整数で入力してください。');
      }
      if (
        !Number.isInteger(juniorCapacityValue) ||
        juniorCapacityValue < 0 ||
        juniorCapacityValue > capacityValue
      ) {
        throw new Error('中学生枠は0〜定員の範囲で入力してください。');
      }
      const { error: invokeError } = await supabase.functions.invoke(
        'organization-admin',
        {
          body: {
            action: 'updateTicketSettings',
            isAccepting: nextIsAccepting,
            capacity: capacityValue,
            juniorCapacity: juniorCapacityValue,
          },
          headers: sessionHeaders(),
        },
      );
      if (invokeError) {
        throw invokeError;
      }
      await load();
      setNotice('受付・定員設定を更新しました。');
      return true;
    } catch (cause) {
      setError(await readErrorMessage(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleAcceptingChange = async (nextIsAccepting: boolean) => {
    const previous = isAccepting;
    setIsAccepting(nextIsAccepting);
    const saved = await saveTicketSettings(nextIsAccepting);
    if (!saved) {
      setIsAccepting(previous);
    }
  };

  const openCapacityModal = () => {
    setDraftCapacity(capacity);
    setDraftJuniorCapacity(juniorCapacity);
    setShowCapacityModal(true);
  };

  const saveCapacitySettings = async (event: Event) => {
    event.preventDefault();
    const saved = await saveTicketSettings(
      isAccepting,
      draftCapacity,
      draftJuniorCapacity,
    );
    if (saved) {
      setShowCapacityModal(false);
    }
  };

  const roundNames = useMemo(
    () =>
      Array.from(
        new Set(dashboard?.tickets.map((ticket) => ticket.round_name) ?? []),
      ),
    [dashboard],
  );
  const displayedTickets = useMemo(
    () =>
      dashboard?.tickets.filter(
        (ticket) => roundFilter === 'all' || ticket.round_name === roundFilter,
      ) ?? [],
    [dashboard, roundFilter],
  );
  if (checking) {
    return <LoadingSpinner message='認証状態を確認しています...' />;
  }
  if (!dashboard) {
    return (
      <>
        <h1 className={subPageStyles.pageTitle}>クラス・部活用管理ページ</h1>
        <div className={styles.shell}>
          <NormalSection>
            <h2>ログイン</h2>
            <form onSubmit={login} className={styles.form}>
              <label>
                ユーザー名
                <input
                  value={username}
                  onInput={(e) =>
                    setUsername((e.target as HTMLInputElement).value)
                  }
                  required
                  autoComplete='username'
                />
              </label>
              <label>
                パスワード
                <input
                  type='password'
                  value={password}
                  onInput={(e) =>
                    setPassword((e.target as HTMLInputElement).value)
                  }
                  required
                  autoComplete='current-password'
                />
              </label>
              {error && <Alert type='error'>{error}</Alert>}
              <button disabled={busy}>
                {busy ? 'ログイン中...' : 'ログイン'}
              </button>
            </form>
          </NormalSection>
        </div>
      </>
    );
  }

  const name =
    dashboard.kind === 'class'
      ? `${dashboard.performance.class_name} ${dashboard.performance.title || ''}`
      : `${dashboard.performance.group_name} ${dashboard.performance.round_name || ''}`;
  return (
    <>
      <h1 className={subPageStyles.pageTitle}>クラス・部活用管理ページ</h1>
      <div className={styles.shell}>
        <div className={styles.heading}>
          <div>
            <h2 className={subPageStyles.linedH2}>{name}</h2>
          </div>
          <button
            type='button'
            className={styles.secondary}
            onClick={() => {
              localStorage.removeItem(TOKEN_KEY);
              setDashboard(null);
            }}
          >
            ログアウト
          </button>
        </div>
        <NormalSection>
          <h2>公演情報</h2>
          <form onSubmit={save} className={styles.form}>
            {dashboard.kind === 'class' && (
              <label>
                公演タイトル
                <input
                  value={title}
                  maxLength={200}
                  onInput={(e) =>
                    setTitle((e.target as HTMLInputElement).value)
                  }
                  required
                />
              </label>
            )}
            <label>
              公演説明
              <textarea
                value={description}
                maxLength={2000}
                onInput={(e) =>
                  setDescription((e.target as HTMLTextAreaElement).value)
                }
              />
            </label>
            <button disabled={busy}>{busy ? '保存中...' : '変更を保存'}</button>
          </form>
          {messageScope === 'performance' && error && <Alert type='error'>{error}</Alert>}
          {messageScope === 'performance' && notice && <Alert type='info'>{notice}</Alert>}
        </NormalSection>
        <NormalSection>
          <h2>公演画像</h2>
          <div className={styles.imageSettings}>
            {typeof dashboard.performance.image_path === 'string' &&
              dashboard.performance.image_path && (
                <img
                  className={styles.performanceImagePreview}
                  src={getPerformanceImageUrl(
                    dashboard.performance.image_path,
                    imageVersion || undefined,
                  )}
                  alt='現在の公演画像'
                />
              )}
            <label className={styles.imageUploadLabel}>
              {isUploadingImage ? 'アップロード中...' : '画像を差し替える'}
              <input
                type='file'
                accept='image/jpeg,image/png,image/webp'
                onChange={uploadImage}
                disabled={isUploadingImage}
              />
            </label>
            <p className={styles.imageHint}>
              JPEG・PNG・WebP形式、5MB以下の画像を選択してください。
            </p>
          </div>
          {messageScope === 'image' && error && <Alert type='error'>{error}</Alert>}
          {messageScope === 'image' && notice && <Alert type='info'>{notice}</Alert>}
        </NormalSection>
        <NormalSection>
          <h2>受付・定員設定</h2>
          <div className={styles.settingsList}>
            <Alert type='warning'>
              定員はむやみに変更しないでください。変更があった場合は総務から理由の確認が入ることがあります。
            </Alert>
            <div className={styles.settingRow}>
              <span>チケット受付を有効にする</span>
              <label>
                <Switch
                  id='organization-is-accepting'
                  checked={isAccepting}
                  onChange={handleAcceptingChange}
                />
              </label>
            </div>
            <div className={styles.settingRow}>
              <div>
                <span>定員</span>
                <p>
                  {capacity}人（中学生枠 {juniorCapacity}人）
                </p>
              </div>
              <button
                type='button'
                className={styles.inlineEditButton}
                onClick={openCapacityModal}
                disabled={busy}
              >
                変更する
              </button>
            </div>
          </div>
          {messageScope === 'ticketSettings' && error && <Alert type='error'>{error}</Alert>}
          {messageScope === 'ticketSettings' && notice && <Alert type='info'>{notice}</Alert>}
        </NormalSection>
        <NormalSection>
          <div className={styles.ticketHeading}>
            <div>
              <h2>チケット一覧</h2>
              <p>有効 {displayedTickets.length} 枚</p>
            </div>
            <button type='button' onClick={() => downloadCsv(displayedTickets)}>
              名簿をCSV出力
            </button>
          </div>
          <label className={styles.filterLabel}>
            公演回
            <select
              value={roundFilter}
              onChange={(event) =>
                setRoundFilter((event.target as HTMLSelectElement).value)
              }
            >
              <option value='all'>すべて</option>
              {roundNames.map((roundName) => (
                <option key={roundName} value={roundName}>
                  {roundName}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>コード</th>
                  <th>公演回</th>
                  <th>学年・クラス・番号</th>
                  <th>発行日時</th>
                </tr>
              </thead>
              <tbody>
                {displayedTickets.map(({ id, tickets, round_name }) => (
                  <tr key={id}>
                    <td>{tickets.code}</td>
                    <td>{round_name}</td>
                    <td>{formatAffiliation(tickets.users?.affiliation)}</td>
                    <td>
                      {new Date(tickets.created_at).toLocaleString('ja-JP')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </NormalSection>
        <NormalSection>
          <h2>パスワード変更</h2>
          <form onSubmit={changePassword} className={styles.form}>
            <input
            type='text'
            name='username'
            value={dashboard.username}
            autocomplete='username'
            style='display: none;'
            aria-hidden='true'
          />
            <label>
              現在のパスワード
              <input
                type='password'
                value={currentPassword}
                onInput={(e) =>
                  setCurrentPassword((e.target as HTMLInputElement).value)
                }
                required
                autoComplete='current-password'
              />
            </label>
            <label>
              新しいパスワード
              <input
                type='password'
                value={newPassword}
                onInput={(e) =>
                  setNewPassword((e.target as HTMLInputElement).value)
                }
                required
                minLength={8}
                autoComplete='new-password'
              />
            </label>
            <label>
              新しいパスワード（確認）
              <input
                type='password'
                value={confirmPassword}
                onInput={(e) =>
                  setConfirmPassword((e.target as HTMLInputElement).value)
                }
                required
                minLength={8}
                autoComplete='new-password'
              />
            </label>
            <button disabled={busy}>パスワードを変更</button>
          </form>
          {messageScope === 'password' && error && <Alert type='error'>{error}</Alert>}
          {messageScope === 'password' && notice && <Alert type='info'>{notice}</Alert>}
        </NormalSection>
      {showCapacityModal && (
          <div
            className={styles.modalOverlay}
            role='presentation'
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !busy) {
                setShowCapacityModal(false);
              }
            }}
          >
            <div
              className={styles.modal}
              role='dialog'
              aria-modal='true'
              aria-labelledby='capacity-modal-title'
              onClick={(event) => event.stopPropagation()}
            >
              <h3 id='capacity-modal-title'>定員を変更</h3>
              <form onSubmit={saveCapacitySettings} className={styles.form}>
                <label>
                  {dashboard.kind === 'class' ? '全体定員' : '定員'}
                  <input
                    type='number'
                    min='1'
                    max='10000'
                    value={draftCapacity}
                    onInput={(event) =>
                      setDraftCapacity((event.target as HTMLInputElement).value)
                    }
                    required
                  />
                </label>
                <label>
                  中学生枠
                  <input
                    type='number'
                    min='0'
                    max={draftCapacity || '10000'}
                    value={draftJuniorCapacity}
                    onInput={(event) =>
                      setDraftJuniorCapacity(
                        (event.target as HTMLInputElement).value,
                      )
                    }
                    required
                  />
                </label>
                {messageScope === 'ticketSettings' && error && (
                  <Alert type='error'>{error}</Alert>
                )}
                <div className={styles.modalActions}>
                  <button
                    type='button'
                    className={styles.modalCancel}
                    onClick={() => setShowCapacityModal(false)}
                    disabled={busy}
                  >
                    キャンセル
                  </button>
                  <button type='submit' disabled={busy}>
                    {busy ? '保存中...' : '保存'}
                  </button>
                </div>
              </form>
            </div>
          </div>
      )}
      {showDeploymentNotice && (
        <div
          className={styles.modalOverlay}
          role='presentation'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowDeploymentNotice(false);
            }
          }}
        >
          <div
            className={styles.modal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='deployment-notice-title'
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id='deployment-notice-title'>公演情報を変更しました</h3>
            <Alert>
              変更は完了しましたが、ここで変更しただけでは反映されません。<strong>お問い合わせフォームから「公演情報を変更したので再デプロイをしてほしい」</strong>と連絡をお願いします。
            </Alert>
            <div className={styles.modalActions}>
              <button type='button' onClick={() => setShowDeploymentNotice(false)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
};
export default OrganizationAdmin;
