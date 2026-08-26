import { useEffect, useState } from 'preact/hooks';
import Alert from '../../components/ui/Alert';
import BackButton from '../../components/ui/BackButton';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import NormalSection from '../../components/ui/NormalSection';
import {
  ADMIN_CONTROL_PANEL_SESSION_TOKEN_KEY,
  readErrorMessage,
} from '../../layout/AdminAuthLayout';
import { supabase } from '../../lib/supabase';
import { useTitle } from '../../hooks/useTitle';
import { MdClose } from 'react-icons/md';
import styles from './PublicRehearsals.module.css';

type Rehearsal = {
  id: number;
  class_id: number;
  round_name: string;
  start_time: string;
  end_time: string;
  capacity: number;
  is_active: boolean;
  active_ticket_count: number;
  class_performances: { class_name: string; total_capacity: number } | null;
};
type ClassRow = { id: number; class_name: string; total_capacity: number };
type RoundName = {
  id: number;
  name: string;
  sort_order: number;
  start_time: string | null;
  end_time: string | null;
};
const localValue = (value: string) =>
  new Date(value).toISOString().slice(0, 16);

export default function PublicRehearsals() {
  useTitle('公開リハ管理');
  const [rows, setRows] = useState<Rehearsal[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [names, setNames] = useState<RoundName[]>([]);
  const [classId, setClassId] = useState('');
  const [roundName, setRoundName] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [capacity, setCapacity] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [roundNameId, setRoundNameId] = useState<number | null>(null);
  const [roundNameDraft, setRoundNameDraft] = useState('');
  const [sortOrderDraft, setSortOrderDraft] = useState('');
  const [roundStartDraft, setRoundStartDraft] = useState('');
  const [roundEndDraft, setRoundEndDraft] = useState('');
  const invoke = (body: Record<string, unknown>) =>
    supabase.functions.invoke('admin-auth', {
      body,
      headers: {
        'x-admin-session-token':
          localStorage.getItem(ADMIN_CONTROL_PANEL_SESSION_TOKEN_KEY) ?? '',
      },
    });
  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await invoke({ action: 'getOfficialRehearsals' });
      if (error) {
        throw error;
      }
      setRows(data.rehearsals ?? []);
      setClasses(data.classes ?? []);
      setNames(data.roundNames ?? []);
    } catch (reason) {
      setError(await readErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const reset = () => {
    setEditing(null);
    setClassId('');
    setRoundName('');
    setStartTime('');
    setEndTime('');
    setCapacity('');
  };
  const selectClass = (value: string) => {
    setClassId(value);
    const item = classes.find((row) => row.id === Number(value));
    if (item) {
      setCapacity(String(item.total_capacity));
    }
  };
  const selectRoundName = (value: string) => {
    setRoundName(value);
    const selected = names.find((item) => item.name === value);
    setStartTime(selected?.start_time ? localValue(selected.start_time) : '');
    setEndTime(selected?.end_time ? localValue(selected.end_time) : '');
  };
  const save = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error } = await invoke({
        action: 'saveOfficialRehearsal',
        id: editing ?? undefined,
        classId: Number(classId),
        roundName,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        capacity: Number(capacity),
      });
      if (error) {
        throw error;
      }
      setNotice(
        editing ? '公開リハを更新しました。' : '公開リハを追加しました。',
      );
      reset();
      await load();
    } catch (reason) {
      setError(await readErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const edit = (row: Rehearsal) => {
    setEditing(row.id);
    setClassId(String(row.class_id));
    setRoundName(row.round_name);
    setStartTime(localValue(row.start_time));
    setEndTime(localValue(row.end_time));
    setCapacity(String(row.capacity));
  };
  const remove = async (id: number) => {
    if (!confirm('この公開リハを削除・中止しますか？')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error } = await invoke({ action: 'deleteOfficialRehearsal', id });
      if (error) {
        throw error;
      }
      setNotice('公開リハを削除・中止しました。');
      await load();
    } catch (reason) {
      setError(await readErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const resetRoundName = () => {
    setRoundNameId(null);
    setRoundNameDraft('');
    setSortOrderDraft('');
    setRoundStartDraft('');
    setRoundEndDraft('');
  };
  const saveRoundName = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error } = await invoke({
        action: 'saveRehearsalRoundName',
        roundNameId: roundNameId ?? undefined,
        name: roundNameDraft,
        sortOrder: Number(sortOrderDraft),
        startTime: new Date(roundStartDraft).toISOString(),
        endTime: new Date(roundEndDraft).toISOString(),
      });
      if (error) {
        throw error;
      }
      setNotice(roundNameId ? '回名を更新しました。' : '回名を追加しました。');
      resetRoundName();
      await load();
    } catch (reason) {
      setError(await readErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const editRoundName = (item: RoundName) => {
    setRoundNameId(item.id);
    setRoundNameDraft(item.name);
    setSortOrderDraft(String(item.sort_order));
    setRoundStartDraft(item.start_time ? localValue(item.start_time) : '');
    setRoundEndDraft(item.end_time ? localValue(item.end_time) : '');
  };
  const deleteRoundName = async (id: number) => {
    if (!confirm('この回名を削除しますか？')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error } = await invoke({
        action: 'deleteRehearsalRoundName',
        roundNameId: id,
      });
      if (error) {
        throw error;
      }
      setNotice('回名を削除しました。');
      if (roundNameId === id) {
        resetRoundName();
      }
      await load();
    } catch (reason) {
      setError(await readErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.pageShell}>
      <BackButton href='/admin/settings' />
      <h1>公開リハ管理</h1>
      <NormalSection>
        <h2>公開リハの回名</h2>
        <p className={styles.lead}>
          表示順は発券画面の公開リハ表の列順になります。日時は公開リハ作成時に自動設定されます。
        </p>
        {!roundNameId && (
          <form className={styles.formGrid} onSubmit={saveRoundName}>
            <label>
              表示名
              <input
                value={roundNameDraft}
                maxLength={100}
                onInput={(event) =>
                  setRoundNameDraft((event.target as HTMLInputElement).value)
                }
                required
              />
            </label>
            <label>
              表示順
              <input
                type='number'
                value={sortOrderDraft}
                onInput={(event) =>
                  setSortOrderDraft((event.target as HTMLInputElement).value)
                }
                required
              />
            </label>
            <label>
              開始
              <input
                type='datetime-local'
                value={roundStartDraft}
                onInput={(event) =>
                  setRoundStartDraft((event.target as HTMLInputElement).value)
                }
                required
              />
            </label>
            <label>
              終了
              <input
                type='datetime-local'
                value={roundEndDraft}
                onInput={(event) =>
                  setRoundEndDraft((event.target as HTMLInputElement).value)
                }
                required
              />
            </label>
            <div className={styles.actions}>
              <button className={styles.button} disabled={busy}>
                {roundNameId ? '回名を更新' : '回名を追加'}
              </button>
            </div>
          </form>
        )}
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>表示名</th>
                <th>表示順</th>
                <th>日時</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {names.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.sort_order}</td>
                  <td>
                    {item.start_time
                      ? new Date(item.start_time).toLocaleString('ja-JP')
                      : '開始未設定'}{' '}
                    ─{' '}
                    {item.end_time
                      ? new Date(item.end_time).toLocaleTimeString('ja-JP')
                      : '終了未設定'}
                  </td>
                  <td>
                    <button
                      className={styles.secondaryButton}
                      type='button'
                      disabled={busy}
                      onClick={() => editRoundName(item)}
                    >
                      編集
                    </button>{' '}
                    <button
                      className={styles.dangerButton}
                      type='button'
                      disabled={busy}
                      onClick={() => deleteRoundName(item.id)}
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </NormalSection>
      <NormalSection>
        <p className={styles.lead}>
          公開リハは総務のみが管理します。開始後は編集できません。
        </p>
        {error && <Alert type='error'>{error}</Alert>}
        {notice && <Alert type='info'>{notice}</Alert>}
        {!editing && (
          <form className={styles.formGrid} onSubmit={save}>
            <label>
              クラス
              <select
                value={classId}
                disabled={editing !== null}
                onChange={(e) =>
                  selectClass((e.target as HTMLSelectElement).value)
                }
                required
              >
                <option value=''>選択してください</option>
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.class_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              回名
              <select
                value={roundName}
                onChange={(e) =>
                  selectRoundName((e.target as HTMLSelectElement).value)
                }
                required
              >
                <option value=''>選択してください</option>
                {names.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <p className={`${styles.fullWidth} ${styles.hint}`}>
              日時:{' '}
              {startTime
                ? new Date(startTime).toLocaleString('ja-JP')
                : '回名を選択してください'}
              {endTime && ` ─ ${new Date(endTime).toLocaleTimeString('ja-JP')}`}
            </p>
            <label>
              定員
              <input
                type='number'
                min='1'
                value={capacity}
                onInput={(e) =>
                  setCapacity((e.target as HTMLInputElement).value)
                }
                required
              />
            </label>
            <div className={styles.actions}>
              <button
                className={styles.button}
                disabled={busy || !startTime || !endTime}
              >
                追加
              </button>
            </div>
          </form>
        )}
      </NormalSection>
      <NormalSection>
        <h2>登録済みの公開リハ</h2>
        {loading ? (
          <LoadingSpinner />
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>クラス</th>
                  <th>回名</th>
                  <th>日時</th>
                  <th>定員</th>
                  <th>発券中</th>
                  <th>状態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.class_performances?.class_name ?? '-'}</td>
                    <td>{row.round_name}</td>
                    <td>
                      {new Date(row.start_time).toLocaleString('ja-JP')} ─{' '}
                      {new Date(row.end_time).toLocaleTimeString('ja-JP')}
                    </td>
                    <td>{row.capacity}</td>
                    <td>{row.active_ticket_count}</td>
                    <td
                      className={
                        !row.is_active ? styles.statusInactive : undefined
                      }
                    >
                      {row.is_active ? '受付中' : '中止'}
                    </td>
                    <td>
                      <button
                        className={styles.secondaryButton}
                        disabled={
                          busy ||
                          !row.is_active ||
                          new Date(row.start_time) <= new Date()
                        }
                        onClick={() => edit(row)}
                      >
                        編集
                      </button>{' '}
                      <button
                        className={styles.dangerButton}
                        disabled={busy || !row.is_active}
                        onClick={() => remove(row.id)}
                      >
                        削除・中止
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </NormalSection>
      {roundNameId && (
        <div className={styles.modalOverlay}>
          <form
            className={styles.modal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='edit-round-name-title'
            onSubmit={saveRoundName}
          >
            <div className={styles.modalHeader}>
              <h2 id='edit-round-name-title'>公開リハの回名を編集</h2>
              <button
                className={styles.modalClose}
                type='button'
                disabled={busy}
                onClick={resetRoundName}
                aria-label='閉じる'
              >
                <MdClose />
              </button>
            </div>
            <div className={styles.formGrid}>
              <label>
                表示名
                <input
                  value={roundNameDraft}
                  maxLength={100}
                  onInput={(event) =>
                    setRoundNameDraft((event.target as HTMLInputElement).value)
                  }
                  required
                />
              </label>
              <label>
                表示順
                <input
                  type='number'
                  value={sortOrderDraft}
                  onInput={(event) =>
                    setSortOrderDraft((event.target as HTMLInputElement).value)
                  }
                  required
                />
              </label>
              <label>
                開始
                <input
                  type='datetime-local'
                  value={roundStartDraft}
                  onInput={(event) =>
                    setRoundStartDraft((event.target as HTMLInputElement).value)
                  }
                  required
                />
              </label>
              <label>
                終了
                <input
                  type='datetime-local'
                  value={roundEndDraft}
                  onInput={(event) =>
                    setRoundEndDraft((event.target as HTMLInputElement).value)
                  }
                  required
                />
              </label>
              <div className={styles.actions}>
                <button className={styles.button} disabled={busy}>
                  更新
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
      {editing && (
        <div className={styles.modalOverlay}>
          <form
            className={styles.modal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='edit-public-rehearsal-title'
            onSubmit={save}
          >
            <div className={styles.modalHeader}>
              <h2 id='edit-public-rehearsal-title'>公開リハを編集</h2>
              <button
                className={styles.modalClose}
                type='button'
                disabled={busy}
                onClick={reset}
                aria-label='閉じる'
              >
                <MdClose />
              </button>
            </div>
            <div className={styles.formGrid}>
              <label>
                クラス
                <input
                  value={
                    classes.find((item) => item.id === Number(classId))
                      ?.class_name ?? '-'
                  }
                  disabled
                />
              </label>
              <label>
                回名
                <select
                  value={roundName}
                  onChange={(event) =>
                    selectRoundName((event.target as HTMLSelectElement).value)
                  }
                  required
                >
                  <option value=''>選択してください</option>
                  {names.map((item) => (
                    <option key={item.id} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className={`${styles.fullWidth} ${styles.hint}`}>
                日時:{' '}
                {startTime ? new Date(startTime).toLocaleString('ja-JP') : '-'}
                {endTime &&
                  ` ─ ${new Date(endTime).toLocaleTimeString('ja-JP')}`}
              </p>
              <label>
                定員
                <input
                  type='number'
                  min='1'
                  value={capacity}
                  onInput={(event) =>
                    setCapacity((event.target as HTMLInputElement).value)
                  }
                  required
                />
              </label>
              <div className={styles.actions}>
                <button
                  className={styles.button}
                  disabled={busy || !startTime || !endTime}
                >
                  更新
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
