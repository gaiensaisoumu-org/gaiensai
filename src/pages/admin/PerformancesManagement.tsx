import { useEffect, useState } from 'preact/hooks';

import Alert from '../../components/ui/Alert';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import NormalSection from '../../components/ui/NormalSection';
import Switch from '../../components/ui/Switch';
import { useTitle } from '../../hooks/useTitle';
import {
  AdminAuthLayout,
  getSessionToken,
  readErrorMessage,
} from '../../layout/AdminAuthLayout';
import { getPerformanceImageUrl, supabase } from '../../lib/supabase';
import { preparePerformanceImage } from '../../lib/performanceImage';
import styles from './PerformancesManagement.module.css';

type PerformancesManagement = {
  id: number;
  year: number | null;
  class_name: string | null;
  title: string | null;
  description: string | null;
  image_path: string | null;
  total_capacity: number | null;
  junior_capacity: number | null;
  is_accepting: boolean | null;
  performance_type?: 'class' | 'gym' | 'exhibition';
  start_at?: string | null;
  end_at?: string | null;
};

type GymScheduleDraft = {
  performance: PerformancesManagement;
  title: string;
  startAt: string;
  endAt: string;
  totalCapacity: string;
  juniorCapacity: string;
  isAccepting: boolean;
};

const JAPAN_TIME_ZONE = 'Asia/Tokyo';

const toJapanDateTimeInputValue = (value: string | null | undefined) => {
  if (!value) {
    return '';
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: JAPAN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
};

const japanDateTimeInputToIso = (value: string) => {
  const [date, time] = value.split('T');
  const [year, month, day] = (date ?? '').split('-').map(Number);
  const [hour, minute] = (time ?? '').split(':').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute)).toISOString();
};

const PerformancesManagementContent = () => {
  useTitle('公演情報を変更 - 管理画面');
  const [performances, setPerformances] = useState<PerformancesManagement[]>([]);
  const [eventYear, setEventYear] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageVersion, setImageVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingPerformance, setEditingPerformance] =
    useState<PerformancesManagement | null>(null);
  const [editingGymGroup, setEditingGymGroup] = useState<GymScheduleDraft[]>([]);
  const [className, setClassName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [totalCapacity, setTotalCapacity] = useState('');
  const [juniorCapacity, setJuniorCapacity] = useState('');
  const [isAccepting, setIsAccepting] = useState(true);
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        'admin-auth',
        {
          body: { action: 'getClassPerformances' },
          headers: { 'x-admin-session-token': getSessionToken() ?? '' },
        },
      );
      if (invokeError) {
        throw invokeError;
      }
      setPerformances(data?.performances ?? []);
      setEventYear(typeof data?.eventYear === 'number' ? data.eventYear : null);
    } catch (loadError) {
      setError(
        `クラス公演一覧の取得に失敗しました。${await readErrorMessage(loadError)}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const triggerRedeploy = async () => {
    const { data, error } = await supabase.functions.invoke('admin-auth', {
      body: { action: 'triggerRedeploy' },
      headers: { 'x-admin-session-token': getSessionToken() ?? '' },
    });
    if (error || !data?.redeployTriggered) {
      throw error ?? new Error('再デプロイを開始できませんでした。');
    }
  };

  const openEditModal = (performance: PerformancesManagement) => {
    setEditingPerformance(performance);
    setClassName(performance.class_name ?? '');
    setTitle(performance.title ?? '');
    setDescription(performance.description ?? '');
    setTotalCapacity(String(performance.total_capacity ?? 0));
    setJuniorCapacity(String(performance.junior_capacity ?? 0));
    setIsAccepting(performance.is_accepting ?? false);
    setStartAt(toJapanDateTimeInputValue(performance.start_at));
    setEndAt(toJapanDateTimeInputValue(performance.end_at));
    setError(null);
    setSuccess(null);
  };

  const openGymGroupModal = (group: PerformancesManagement[]) => {
    const first = group[0];
    if (!first) {
      return;
    }
    openEditModal(first);
    setEditingGymGroup(group.map((performance) => ({
      performance,
      title: performance.title ?? '',
      startAt: toJapanDateTimeInputValue(performance.start_at),
      endAt: toJapanDateTimeInputValue(performance.end_at),
      totalCapacity: String(performance.total_capacity ?? 0),
      juniorCapacity: String(performance.junior_capacity ?? 0),
      isAccepting: performance.is_accepting ?? false,
    })));
  };

  const closeEditModal = () => {
    if (!isSaving) {
      setEditingPerformance(null);
      setEditingGymGroup([]);
    }
  };

  const save = async (event: Event) => {
    event.preventDefault();
    if (!editingPerformance) {
      return;
    }

    if (editingGymGroup.length > 0) {
      if (!className.trim() || editingGymGroup.some((schedule) =>
        !schedule.title.trim() || !schedule.startAt || !schedule.endAt ||
        schedule.startAt >= schedule.endAt ||
        !Number.isInteger(Number(schedule.totalCapacity)) || Number(schedule.totalCapacity) < 1 ||
        !Number.isInteger(Number(schedule.juniorCapacity)) || Number(schedule.juniorCapacity) < 0 ||
        Number(schedule.juniorCapacity) > Number(schedule.totalCapacity),
      )) {
        setError('団体名と各回の日時・定員・中学生枠を確認してください。');
        return;
      }
      setIsSaving(true);
      try {
        const updated = await Promise.all(editingGymGroup.map(async (schedule) => {
          const { data, error: invokeError } = await supabase.functions.invoke('admin-auth', {
            body: { action: 'updateClassPerformance', recordId: schedule.performance.id, performanceType: 'gym', className, description, title: schedule.title, startAt: japanDateTimeInputToIso(schedule.startAt), endAt: japanDateTimeInputToIso(schedule.endAt), totalCapacity: Number(schedule.totalCapacity), juniorCapacity: Number(schedule.juniorCapacity), isAccepting: schedule.isAccepting },
            headers: { 'x-admin-session-token': getSessionToken() ?? '' },
          });
          if (invokeError || !data?.performance) {
            throw invokeError ?? new Error('保存に失敗しました。');
          }
          return data.performance as PerformancesManagement;
        }));
        setPerformances((current) => current.map((performance) =>
          updated.find((item) => item.id === performance.id && item.performance_type === (performance.performance_type ?? 'class')) ?? performance,
        ));
        setEditingPerformance(null);
        setEditingGymGroup([]);
        await triggerRedeploy();
        setSuccess('体育館公演を更新し、再デプロイを開始しました。');
      } catch (saveError) {
        setError(`体育館公演の更新に失敗しました。${await readErrorMessage(saveError)}`);
      } finally {
        setIsSaving(false);
      }
      return;
    }

    const parsedTotalCapacity = Number(totalCapacity);
    const parsedJuniorCapacity = Number(juniorCapacity);
    if (
      !className.trim() ||
      (editingPerformance.performance_type !== 'exhibition' &&
        (!Number.isInteger(parsedTotalCapacity) ||
          parsedTotalCapacity < 1 ||
          !Number.isInteger(parsedJuniorCapacity) ||
          parsedJuniorCapacity < 0 ||
          parsedJuniorCapacity > parsedTotalCapacity))
    ) {
      setError(
        'クラス名、総定員（1以上の整数）、中学生枠（0以上かつ総定員以下）を確認してください。',
      );
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        'admin-auth',
        {
          body: {
            action: 'updateClassPerformance',
            recordId: editingPerformance.id,
            className,
            title,
            description,
            totalCapacity: parsedTotalCapacity,
            juniorCapacity: parsedJuniorCapacity,
            isAccepting,
            performanceType: editingPerformance.performance_type ?? 'class',
            startAt: startAt ? japanDateTimeInputToIso(startAt) : null,
            endAt: endAt ? japanDateTimeInputToIso(endAt) : null,
          },
          headers: { 'x-admin-session-token': getSessionToken() ?? '' },
        },
      );
      if (invokeError) {
        throw invokeError;
      }
      if (!data?.updated || !data.performance) {
        throw new Error('保存に失敗しました。');
      }
      const updatedPerformance = data.performance as PerformancesManagement;
      setEventYear(
        typeof data.eventYear === 'number' ? data.eventYear : updatedPerformance.year,
      );
      setPerformances((current) =>
        current.map((performance) =>
          performance.id === updatedPerformance.id &&
          (performance.performance_type ?? 'class') ===
            (updatedPerformance.performance_type ?? 'class')
            ? updatedPerformance
            : performance,
        ),
      );
      setEditingPerformance(null);
      await triggerRedeploy();
      setSuccess(
        `${updatedPerformance.class_name ?? 'クラス公演'}を更新し、再デプロイを開始しました。年度は設定中の年度（${updatedPerformance.year ?? '-'}年度）に同期されています。`,
      );
    } catch (saveError) {
      setError(`クラス公演の更新に失敗しました。${await readErrorMessage(saveError)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const uploadImage = async (event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || !editingPerformance) {
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('JPEG・PNG・WebP形式の画像を選択してください。');
      return;
    }
    setIsUploadingImage(true);
    setError(null);
    setSuccess(null);
    try {
      const uploadFile = await preparePerformanceImage(file);
      if (uploadFile.size > 5 * 1024 * 1024) {
        throw new Error('変換後の画像ファイルは5MB以下にしてください。');
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('画像の読み込みに失敗しました。'));
        reader.readAsDataURL(uploadFile);
      });
      const { data, error: invokeError } = await supabase.functions.invoke(
        'admin-auth',
        {
          body: {
            action: 'uploadClassPerformanceImage',
            recordId: editingPerformance.id,
            performanceType: editingPerformance.performance_type ?? 'class',
            contentType: uploadFile.type,
            base64: dataUrl.split(',')[1],
          },
          headers: { 'x-admin-session-token': getSessionToken() ?? '' },
        },
      );
      if (invokeError) {
        throw invokeError;
      }
      if (!data?.updated || !data.performance) {
        throw new Error('画像の更新に失敗しました。');
      }
      const updatedPerformance = data.performance as PerformancesManagement;
      setPerformances((current) =>
        current.map((performance) =>
          performance.id === updatedPerformance.id &&
          (performance.performance_type ?? 'class') ===
            (updatedPerformance.performance_type ?? 'class')
            ? updatedPerformance
            : performance,
        ),
      );
      setEditingPerformance(updatedPerformance);
      setEventYear(
        typeof data.eventYear === 'number' ? data.eventYear : updatedPerformance.year,
      );
      setImageVersion(Date.now());
      await triggerRedeploy();
      setSuccess('公演画像を更新し、再デプロイを開始しました。');
    } catch (uploadError) {
      setError(`画像の更新に失敗しました。${await readErrorMessage(uploadError)}`);
    } finally {
      setIsUploadingImage(false);
      (event.target as HTMLInputElement).value = '';
    }
  };

  const renderPerformanceSection = (
    title: string,
    performanceType: 'class' | 'gym' | 'exhibition',
  ) => {
    const rows = performances.filter(
      (performance) => (performance.performance_type ?? 'class') === performanceType,
    );
    if (performanceType === 'gym') {
      const groups = Array.from(
        rows.reduce((grouped, performance) => {
          const name = performance.class_name ?? '名称未設定';
          const group = grouped.get(name) ?? [];
          group.push(performance);
          grouped.set(name, group);
          return grouped;
        }, new Map<string, PerformancesManagement[]>()),
      );
      return (
        <NormalSection>
          <div className={styles.performanceSection}>
            <h2>{title}</h2>
            <p className={styles.scrollHint}>← 横にスクロールできます →</p>
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>年度</th>
                    <th>団体名</th>
                    <th>公演回・日時</th>
                    <th>定員</th>
                    <th>受付</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.length === 0 ? (
                    <tr>
                      <td colSpan={6} className={styles.empty}>
                        体育館公演は登録されていません。
                      </td>
                    </tr>
                  ) : (
                    groups.map(([groupName, groupPerformances]) => (
                      <tr key={groupName}>
                        <td>{groupPerformances[0]?.year ?? '-'}</td>
                        <td>{groupName}</td>
                        <td>
                          <div className={styles.gymScheduleList}>
                            {groupPerformances.map((performance) => (
                              <div key={performance.id} className={styles.gymSchedule}>
                                <strong>{performance.title || '名称未設定'}</strong>
                                <span>
                                  {performance.start_at
                                    ? new Date(performance.start_at).toLocaleString('ja-JP', { timeZone: JAPAN_TIME_ZONE })
                                    : '-'}
                                  {' 〜 '}
                                  {performance.end_at
                                    ? new Date(performance.end_at).toLocaleString('ja-JP', { timeZone: JAPAN_TIME_ZONE })
                                    : '-'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td>
                          <div className={styles.gymScheduleList}>
                            {groupPerformances.map((performance) => (
                              <span key={performance.id} className={styles.gymSchedule}>
                                {performance.total_capacity ?? 0}名（中学生 {performance.junior_capacity ?? 0}名）
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>
                          <div className={styles.gymScheduleList}>
                            {groupPerformances.map((performance) => (
                              <span key={performance.id} className={styles.gymSchedule}>
                                {performance.is_accepting ? '受付中' : '停止中'}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>
                          <button
                            type='button'
                            className={styles.editButton}
                            onClick={() => openGymGroupModal(groupPerformances)}
                          >
                            編集
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </NormalSection>
      );
    }
    return (
      <NormalSection>
        <div className={styles.performanceSection}>
          <h2>{title}</h2>
        <p className={styles.scrollHint}>← 横にスクロールできます →</p>
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                {performanceType !== 'exhibition' && <th>年度</th>}
                <th>{performanceType === 'class' ? 'クラス' : '団体名'}</th>
                {performanceType !== 'exhibition' && <th>公演タイトル</th>}
                <th>説明</th>
                {performanceType !== 'exhibition' && <th>総定員</th>}
                {performanceType !== 'exhibition' && <th>中学生枠</th>}
                {performanceType !== 'exhibition' && <th>受付</th>}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={performanceType === 'exhibition' ? 4 : 9} className={styles.empty}>
                    {title}は登録されていません。
                  </td>
                </tr>
              ) : (
                rows.map((performance) => (
                  <tr key={`${performanceType}-${performance.id}`}>
                    <td>{performance.id}</td>
                    {performanceType !== 'exhibition' && <td>{performance.year ?? '-'}</td>}
                    <td>{performance.class_name ?? '-'}</td>
                    {performanceType !== 'exhibition' && <td>{performance.title || '-'}</td>}
                    <td className={styles.description}>
                      {performance.description || '-'}
                    </td>
                    {performanceType !== 'exhibition' && <td>
                      {performance.total_capacity === null
                        ? '-'
                        : `${performance.total_capacity}名`}
                    </td>}
                    {performanceType !== 'exhibition' && <td>
                      {performance.junior_capacity === null
                        ? '-'
                        : `${performance.junior_capacity}名`}
                    </td>}
                    {performanceType !== 'exhibition' && <td>
                      {performance.is_accepting === null
                        ? '-'
                        : performance.is_accepting
                          ? '受付中'
                          : '停止中'}
                    </td>}
                    <td>
                      <button
                        type='button'
                        className={styles.editButton}
                        onClick={() => openEditModal(performance)}
                      >
                        編集
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        </div>
      </NormalSection>
    );
  };

  return (
    <div className={styles.pageShell}>
      <NormalSection>
        <div className={styles.headerRow}>
          <div>
            <h2>公演情報を変更</h2>
            <p className={styles.note}>
              クラス・体育館・展示公演の情報、定員、受付状態を編集できます。保存時の年度は設定中の年度に自動同期され、再デプロイが自動で開始されます。
            </p>
          </div>
          <button
            type='button'
            className={styles.refreshButton}
            onClick={() => void load()}
            disabled={isLoading || isSaving}
          >
            {isLoading ? '更新中...' : '一覧を更新'}
          </button>
        </div>

        {error && <Alert type='error'>{error}</Alert>}
        {success && <Alert type='info'>{success}</Alert>}
      </NormalSection>

      {isLoading ? (
        <LoadingSpinner message='クラス公演一覧を読み込み中です...' />
      ) : (
        <>
          {renderPerformanceSection('クラス公演', 'class')}
          {renderPerformanceSection('体育館公演', 'gym')}
          {renderPerformanceSection('展示公演', 'exhibition')}
        </>
      )}

      {editingPerformance && (
        <div
          className={styles.modalOverlay}
          role='presentation'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeEditModal();
            }
          }}
        >
          <form
            className={styles.modal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='edit-class-performance-title'
            onSubmit={save}
          >
            <h3 id='edit-class-performance-title'>公演情報を編集</h3>
            <p className={styles.modalNote}>
              {eventYear === null
                ? '年度は全体設定の年度に自動更新します。これは全体設定の年度欄で変更できます。'
                : `年度は${eventYear}に自動更新します。これは全体設定の年度欄で変更できます。`}
            </p>
            <label>
              {editingPerformance.performance_type === 'class' ? 'クラス名' : '団体名'}
              <input
                value={className}
                onInput={(event) =>
                  setClassName((event.target as HTMLInputElement).value)
                }
                maxLength={100}
                required
              />
            </label>
            {editingGymGroup.length > 0 && <>
              <h4>団体共通</h4>
              <label>説明
                <textarea value={description} onInput={(event) => setDescription((event.target as HTMLTextAreaElement).value)} maxLength={5000} rows={5} />
              </label>
              <div className={styles.imageSettings}>
                {editingPerformance.image_path && <img className={styles.imagePreview} src={getPerformanceImageUrl(editingPerformance.image_path, imageVersion || undefined)} alt='現在の公演画像' />}
                <label className={styles.imageUploadLabel}>
                  {isUploadingImage ? 'アップロード中...' : '画像を差し替える'}
                  <input type='file' accept='image/jpeg,image/png,image/webp' onChange={uploadImage} disabled={isUploadingImage || isSaving} />
                </label>
                <span className={styles.imageHint}>JPEG・PNGは横幅560pxのWebPに変換してアップロードします。WebPは5MB以下にしてください。</span>
              </div>
              <h4>各公演回</h4>
              {editingGymGroup.map((schedule, index) => (
                <fieldset key={schedule.performance.id} className={styles.scheduleFieldset}>
                  <legend>公演回 {index + 1}</legend>
                  <label>回名<input value={schedule.title} onInput={(event) => setEditingGymGroup((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: (event.target as HTMLInputElement).value } : item))} required /></label>
                  <div className={styles.capacityFields}>
                    <label>開始時刻<input type='datetime-local' value={schedule.startAt} onInput={(event) => setEditingGymGroup((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, startAt: (event.target as HTMLInputElement).value } : item))} required /></label>
                    <label>終了時刻<input type='datetime-local' value={schedule.endAt} onInput={(event) => setEditingGymGroup((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, endAt: (event.target as HTMLInputElement).value } : item))} required /></label>
                    <label>総定員<input type='number' min='1' value={schedule.totalCapacity} onInput={(event) => setEditingGymGroup((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, totalCapacity: (event.target as HTMLInputElement).value } : item))} required /></label>
                    <label>中学生枠<input type='number' min='0' value={schedule.juniorCapacity} onInput={(event) => setEditingGymGroup((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, juniorCapacity: (event.target as HTMLInputElement).value } : item))} required /></label>
                  </div>
                  <div className={styles.acceptingControl}><span>受付を有効にする</span><Switch checked={schedule.isAccepting} onChange={(checked) => setEditingGymGroup((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, isAccepting: checked } : item))} /></div>
                </fieldset>
              ))}
            </>}
            {editingGymGroup.length === 0 && editingPerformance.performance_type !== 'exhibition' && <label>
              {editingPerformance.performance_type === 'gym' ? '回名' : '公演タイトル'}
              <input
                value={title}
                onInput={(event) =>
                  setTitle((event.target as HTMLInputElement).value)
                }
                maxLength={200}
              />
            </label>}
            {editingGymGroup.length === 0 && editingPerformance.performance_type === 'gym' && <div className={styles.capacityFields}>
              <label>開始時刻<input type='datetime-local' value={startAt} onInput={(event) => setStartAt((event.target as HTMLInputElement).value)} required /></label>
              <label>終了時刻<input type='datetime-local' value={endAt} onInput={(event) => setEndAt((event.target as HTMLInputElement).value)} required /></label>
            </div>}
            {editingGymGroup.length === 0 && <label>
              説明
              <textarea
                value={description}
                onInput={(event) =>
                  setDescription((event.target as HTMLTextAreaElement).value)
                }
                maxLength={5000}
                rows={5}
              />
            </label>}
            {editingGymGroup.length === 0 && <div className={styles.imageSettings}>
              {editingPerformance.image_path && (
                <img
                  className={styles.imagePreview}
                  src={getPerformanceImageUrl(
                    editingPerformance.image_path,
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
                  disabled={isUploadingImage || isSaving}
                />
              </label>
              <span className={styles.imageHint}>
                JPEG・PNGは横幅560pxのWebPに変換してアップロードします。WebPは5MB以下にしてください。
              </span>
            </div>}
            {editingGymGroup.length === 0 && editingPerformance.performance_type !== 'exhibition' && <div className={styles.capacityFields}>
              <label>
                総定員
                <input
                  type='number'
                  min='1'
                  max='10000'
                  value={totalCapacity}
                  onInput={(event) =>
                    setTotalCapacity((event.target as HTMLInputElement).value)
                  }
                  required
                />
              </label>
              <label>
                中学生枠
                <input
                  type='number'
                  min='0'
                  max='10000'
                  value={juniorCapacity}
                  onInput={(event) =>
                    setJuniorCapacity((event.target as HTMLInputElement).value)
                  }
                  required
                />
              </label>
            </div>}
            {editingGymGroup.length === 0 && editingPerformance.performance_type !== 'exhibition' && <div className={styles.acceptingControl}>
              <span>受付を有効にする</span>
              <Switch checked={isAccepting} onChange={setIsAccepting} />
            </div>}
            <div className={styles.modalActions}>
              <button type='button' onClick={closeEditModal} disabled={isSaving || isUploadingImage}>
                キャンセル
              </button>
              <button type='submit' className={styles.saveButton} disabled={isSaving || isUploadingImage}>
                {isSaving ? '保存中...' : '保存'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

const PerformancesManagement = () => (
  <AdminAuthLayout
    title='公演情報を変更'
    description='クラス・体育館・展示公演の情報と受付設定を管理します。'
  >
    <PerformancesManagementContent />
  </AdminAuthLayout>
);

export default PerformancesManagement;
