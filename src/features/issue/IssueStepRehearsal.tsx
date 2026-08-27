import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import NormalSection from '../../components/ui/NormalSection';
import { supabase } from '../../lib/supabase';
import type { SelectedPerformance } from '../../types/Issue.types';
import styles from '../../pages/user/students/Issue.module.css';

import { RiCircleLine, RiCloseLargeLine, RiTriangleLine } from 'react-icons/ri';
import { FaMinus } from 'react-icons/fa6';
import Alert from '../../components/ui/Alert';

type Row = {
  class_id: number;
  class_name: string;
  performance_title: string | null;
  round_id: number;
  round_name: string;
  start_time: string;
  end_time: string;
  capacity: number;
  active_ticket_count: number;
  type: 'official' | 'unofficial';
  is_ticket_accepting: boolean;
};
type RehearsalRow = Omit<Row, 'class_name'> & {
  type: 'official' | 'unofficial';
  class_performances: { class_name: string; title: string | null } | null;
};
type SortOrder = 'class' | 'time';
const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  });
const formatDate = (value: string) =>
  new Date(value).toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });

export default function IssueStepRehearsal({
  selectedPerformance,
  onSelectPerformance,
  inviteMode,
  dashboardMode = false,
  showOfficialSchedule = true,
  showUnofficialSchedule = true,
  onOfficialCellClick,
  onUnofficialRowClick,
}: {
  selectedPerformance: SelectedPerformance;
  onSelectPerformance: (value: SelectedPerformance) => void;
  inviteMode:
    | 'open'
    | 'only-own'
    | 'public-rehearsals'
    | 'self-rehearsals'
    | 'self-rehearsals-list-only'
    | 'off';
  dashboardMode?: boolean;
  showOfficialSchedule?: boolean;
  showUnofficialSchedule?: boolean;
  onOfficialCellClick?: () => void;
  onUnofficialRowClick?: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [roundNames, setRoundNames] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState<SortOrder>('time');
  const officialTableWrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void Promise.all([
      supabase
        .from('rehearsals')
        .select('*, class_performances(class_name, title)')
        .eq('is_active', true),
      supabase.from('rehearsal_round_names').select('name').order('sort_order'),
      supabase
        .from('student_rehearsal_issue_counters')
        .select('rehearsal_type, issued_count'),
    ]).then(([rehearsalResult, namesResult]) => {
      setRows(
        ((rehearsalResult.data ?? []) as RehearsalRow[]).map((row) => ({
          ...row,
          class_name: row.class_performances?.class_name ?? '未設定クラス',
          performance_title: row.class_performances?.title ?? null,
        })),
      );
      setRoundNames((namesResult.data ?? []).map((item) => item.name));
    });
  }, []);
  const [now] = useState(() => new Date().getTime());
  const canIssueOfficial =
    inviteMode === 'open' || inviteMode === 'public-rehearsals';
  const canIssueUnofficial =
    inviteMode === 'open' || inviteMode === 'self-rehearsals';
  const showUnofficialListOnly = inviteMode === 'self-rehearsals-list-only';
  const officialRows = rows.filter((row) => row.type === 'official');
  const unofficialRows = rows.filter(
    (row) =>
      row.type === 'unofficial' && new Date(row.start_time).getTime() > now,
  );
  const classes = useMemo(
    () =>
      Array.from(new Set(officialRows.map((row) => row.class_name))).sort(
        (a, b) => a.localeCompare(b, 'ja'),
      ),
    [officialRows],
  );
  const rehearsals = useMemo(
    () =>
      [...unofficialRows].sort((a, b) =>
        sortOrder === 'class'
          ? a.class_name.localeCompare(b.class_name, 'ja') ||
            a.start_time.localeCompare(b.start_time)
          : a.start_time.localeCompare(b.start_time) ||
            a.class_name.localeCompare(b.class_name, 'ja'),
      ),
    [unofficialRows, sortOrder],
  );
  useEffect(() => {
    const wrapper = officialTableWrapperRef.current;
    if (!wrapper) {
      return;
    }
    const updateScrollState = () => {
      const { scrollLeft, scrollWidth, clientWidth } = wrapper;
      if (scrollWidth <= clientWidth) {
        wrapper.removeAttribute('data-scroll-fade');
        return;
      }
      const isAtStart = scrollLeft <= 1;
      const isAtEnd = Math.abs(scrollWidth - clientWidth - scrollLeft) <= 1;
      wrapper.setAttribute(
        'data-scroll-fade',
        isAtStart ? 'start' : isAtEnd ? 'end' : 'middle',
      );
    };
    updateScrollState();
    wrapper.addEventListener('scroll', updateScrollState, { passive: true });
    window.addEventListener('resize', updateScrollState);
    return () => {
      wrapper.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', updateScrollState);
    };
  }, [classes.length, roundNames.length]);
  return (
    <NormalSection>
      {!dashboardMode && (
        <div className={styles.rehearsalHeading}>
          <div>
            <h2 className={styles.sectionTitle}>2. リハーサルを選択</h2>
            <p>
              {canIssueOfficial && canIssueUnofficial
                ? '取得したい公開リハまたは非公式リハを選択してください。'
                : canIssueOfficial
                  ? '取得したい公開リハを選択してください。'
                  : canIssueUnofficial
                    ? '取得したい非公式リハを選択してください。'
                    : showUnofficialListOnly
                      ? '非公式公開リハーサルの一覧を確認できます。チケットの受付は行っていません。'
                      : '現在リハーサルのチケット発券は停止中です。'}
            </p>
          </div>
        </div>
      )}
      {dashboardMode && <h2>公開リハ スケジュール</h2>}
      {((dashboardMode && showOfficialSchedule) || canIssueOfficial) && (
        <>
          {!dashboardMode && <h3>公開リハ</h3>}
          {!canIssueOfficial && (
            <Alert type='info'>
              公開リハで整理券は使用しません。直接各クラスの前で並んでください。このテーブルはスケジュール確認にご利用ください。
            </Alert>
          )}
          <p className={styles.officialRehearsalScrollHint}>
            ← 横にスクロールできます →
          </p>
          <div
            className={styles.officialRehearsalTableWrap}
            ref={officialTableWrapperRef}
          >
            <table className={styles.officialRehearsalTable}>
              <thead>
                <tr>
                  <th className={styles.officialRehearsalTh}>クラス</th>
                  {roundNames.map((name) => (
                    <th className={styles.officialRehearsalTh} key={name}>
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {classes.map((className) => (
                  <tr key={className}>
                    <th className={styles.officialRehearsalTh}>{className}</th>
                    {roundNames.map((roundName) => {
                      const row = officialRows.find(
                        (item) =>
                          item.class_name === className &&
                          item.round_name === roundName,
                      );
                      if (!row) {
                        return (
                          <td
                            className={`${styles.officialRehearsalTd} ${styles.officialRehearsalEmptyCell}`}
                            key={roundName}
                          >
                            <FaMinus />
                          </td>
                        );
                      }
                      const remaining = Math.max(
                        row.capacity - row.active_ticket_count,
                        0,
                      );
                      const isSelected =
                        selectedPerformance?.performanceId === row.class_id &&
                        selectedPerformance.scheduleId === row.round_id;
                      const started = new Date(row.start_time).getTime() <= now;
                      const ended = new Date(row.end_time).getTime() <= now;
                      const status =
                        remaining <= 0
                          ? 'cross'
                          : remaining < Math.ceil(row.capacity / 3)
                            ? 'triangle'
                            : 'circle';
                      const statusClass =
                        status === 'circle'
                          ? styles.officialRehearsalCircle
                          : status === 'triangle'
                            ? styles.officialRehearsalTriangle
                            : styles.officialRehearsalCross;
                      const availabilityMark =
                        status === 'circle' ? (
                          <RiCircleLine />
                        ) : status === 'triangle' ? (
                          <RiTriangleLine />
                        ) : (
                          <RiCloseLargeLine />
                        );
                      return (
                        <td
                          className={`${styles.officialRehearsalTd} ${!started ? statusClass : ''} ${isSelected ? styles.officialRehearsalSelectedCell : ''}`}
                          key={roundName}
                        >
                          <button
                            type='button'
                            className={styles.officialRehearsalCell}
                            disabled={
                              !canIssueOfficial || started || remaining <= 0
                            }
                            aria-pressed={isSelected}
                            onClick={() => {
                              if (dashboardMode) {
                                onOfficialCellClick?.();
                                return;
                              }
                              onSelectPerformance({
                                performanceId: row.class_id,
                                performanceName: row.class_name,
                                performanceTitle: row.performance_title,
                                scheduleId: row.round_id,
                                scheduleName: row.round_name,
                                remaining,
                                isOfficialRehearsal: true,
                              });
                            }}
                          >
                            <strong className={styles.officialRehearsalMark}>
                              {ended ? (
                                <>
                                  <FaMinus />
                                  <span>終了</span>
                                </>
                              ) : started ? (
                                <>
                                  <FaMinus />
                                  <span>上演中</span>
                                </>
                              ) : (
                                availabilityMark
                              )}
                            </strong>
                            {!started && (
                              <span
                                className={styles.officialRehearsalRemaining}
                              >
                                残り{remaining}席
                              </span>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {classes.length === 0 && <p>発券可能な公開リハはありません。</p>}
          </div>
          {!dashboardMode &&
            selectedPerformance &&
            officialRows.some(
              (row) =>
                row.class_id === selectedPerformance.performanceId &&
                row.round_id === selectedPerformance.scheduleId,
            ) && (
              <p className={styles.selectedText}>
                選択中: {selectedPerformance.performanceName} /{' '}
                {selectedPerformance.scheduleName}（残り
                {selectedPerformance.remaining}
                席）
              </p>
            )}
        </>
      )}
      {((dashboardMode && showUnofficialSchedule) ||
        canIssueUnofficial ||
        showUnofficialListOnly) && (
        <>
          <div className={styles.rehearsalSubheadingRow}>
            <h3 className={styles.rehearsalSubheading}>
              {dashboardMode ? '非公式リハ スケジュール' : '非公式リハ'}
            </h3>
            <label className={styles.rehearsalSort}>
              並び順
              <select
                value={sortOrder}
                onChange={(event) =>
                  setSortOrder(
                    (event.target as HTMLSelectElement).value as SortOrder,
                  )
                }
              >
                <option value='class'>クラス順</option>
                <option value='time'>公演時間順</option>
              </select>
            </label>
          </div>
          {!dashboardMode && showUnofficialListOnly && (
            <Alert type='info'>
              非公式公開リハーサルでは整理券を使用しません。直接各クラスの前で並んでください。この一覧はスケジュール確認にご利用ください。
            </Alert>
          )}
          <div className={styles.rehearsalList}>
            {rehearsals.map((row) => {
              const remaining = Math.max(
                row.capacity - row.active_ticket_count,
                0,
              );
              const status =
                remaining <= 0
                  ? 'unavailable'
                  : remaining < Math.ceil(row.capacity / 3)
                    ? 'limited'
                    : 'available';
              const isSelected =
                selectedPerformance?.performanceId === row.class_id &&
                selectedPerformance.scheduleId === row.round_id;
              return (
                <button
                  key={`${row.class_id}-${row.round_id}`}
                  type='button'
                  className={`${styles.rehearsalRow} ${isSelected ? styles.rehearsalRowSelected : ''}`}
                  disabled={
                    (dashboardMode && !onUnofficialRowClick) ||
                    !canIssueUnofficial ||
                    !row.is_ticket_accepting ||
                    remaining <= 0
                  }
                  aria-pressed={isSelected}
                  onClick={() => {
                    if (dashboardMode) {
                      onUnofficialRowClick?.();
                      return;
                    }
                    onSelectPerformance({
                      performanceId: row.class_id,
                      performanceName: row.class_name,
                      performanceTitle: row.performance_title,
                      scheduleId: row.round_id,
                      scheduleName: row.round_name,
                      remaining,
                      isOfficialRehearsal: false,
                    });
                  }}
                >
                  <span className={styles.rehearsalTime}>
                    <strong>
                      {row.class_name} {row.round_name}
                    </strong>
                    <span>
                      {formatDate(row.start_time)} {formatTime(row.start_time)}{' '}
                      ─ {formatTime(row.end_time)}
                    </span>
                  </span>
                  <span
                    className={`${styles.rehearsalRemaining} ${!row.is_ticket_accepting ? styles.rehearsalMinus : status === 'available' ? styles.rehearsalCircle : status === 'limited' ? styles.rehearsalTriangle : styles.rehearsalCross}`}
                  >
                    {!row.is_ticket_accepting ? (
                      <FaMinus />
                    ) : status === 'available' ? (
                      <RiCircleLine />
                    ) : status === 'limited' ? (
                      <RiTriangleLine />
                    ) : (
                      <RiCloseLargeLine />
                    )}
                    <span>
                      {!row.is_ticket_accepting
                        ? '整理券なし'
                        : remaining > 0
                          ? `残り${remaining}席`
                          : '満席'}
                    </span>
                  </span>
                </button>
              );
            })}
            {rehearsals.length === 0 && (
              <p>
                {dashboardMode || showUnofficialListOnly
                  ? '表示できる非公式公開リハーサルはありません。'
                  : '発券可能な非公式公開リハーサルはありません。'}
              </p>
            )}
          </div>
        </>
      )}
    </NormalSection>
  );
}
