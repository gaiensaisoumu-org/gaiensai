import { useEffect, useMemo, useState } from 'preact/hooks';
import NormalSection from '../../components/ui/NormalSection';
import { supabase } from '../../lib/supabase';
import type { SelectedPerformance } from '../../types/Issue.types';
import styles from '../../pages/user/students/Issue.module.css';

import { RiCircleLine, RiCloseLargeLine, RiTriangleLine } from 'react-icons/ri';

type Row = {
  class_id: number;
  class_name: string;
  round_id: number;
  round_name: string;
  start_time: string;
  end_time: string;
  capacity: number;
  active_ticket_count: number;
};
type RehearsalRow = Omit<Row, 'class_name'> & {
  class_performances: { class_name: string } | null;
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
}: {
  selectedPerformance: SelectedPerformance;
  onSelectPerformance: (value: SelectedPerformance) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [sortOrder, setSortOrder] = useState<SortOrder>('class');
  useEffect(() => {
    void supabase
      .from('rehearsals')
      .select('*, class_performances(class_name)')
      .eq('type', 'unofficial')
      .eq('is_active', true)
      .gt('start_time', new Date().toISOString())
      .then(({ data }) =>
        setRows(
          ((data ?? []) as RehearsalRow[]).map((row) => ({
            ...row,
            class_name: row.class_performances?.class_name ?? '未設定クラス',
          })),
        ),
      );
  }, []);
  const rehearsals = useMemo(
    () =>
      [...rows].sort((a, b) =>
        sortOrder === 'class'
          ? a.class_name.localeCompare(b.class_name, 'ja') ||
            a.start_time.localeCompare(b.start_time)
          : a.start_time.localeCompare(b.start_time) ||
            a.class_name.localeCompare(b.class_name, 'ja'),
      ),
    [rows, sortOrder],
  );
  return (
    <NormalSection>
      <div className={styles.rehearsalHeading}>
        <div>
          <h2 className={styles.sectionTitle}>2. リハーサルを選択</h2>
          <p>取得したい自主リハーサルを選択してください。</p>
        </div>
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
      <div className={styles.rehearsalList}>
        {rehearsals.map((row) => {
          const remaining = Math.max(row.capacity - row.active_ticket_count, 0);
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
              disabled={remaining <= 0}
              aria-pressed={isSelected}
              onClick={() =>
                onSelectPerformance({
                  performanceId: row.class_id,
                  performanceName: row.class_name,
                  scheduleId: row.round_id,
                  scheduleName: row.round_name,
                  remaining,
                })
              }
            >
              <span className={styles.rehearsalTime}>
                <strong>
                  {row.class_name} {row.round_name}
                </strong>
                <span>
                  {formatDate(row.start_time)} {formatTime(row.start_time)} ─{' '}
                  {formatTime(row.end_time)}
                </span>
              </span>
              <span
                className={`${styles.rehearsalRemaining} ${status === 'available' ? styles.rehearsalCircle : status === 'limited' ? styles.rehearsalTriangle : styles.rehearsalCross}`}
              >
                {status === 'available' ? (
                  <RiCircleLine />
                ) : status === 'limited' ? (
                  <RiTriangleLine />
                ) : (
                  <RiCloseLargeLine />
                )}
                <span>{remaining > 0 ? `残り${remaining}席` : '満席'}</span>
              </span>
            </button>
          );
        })}
        {rehearsals.length === 0 && (
          <p>発券可能な自主リハーサルはありません。</p>
        )}
      </div>
    </NormalSection>
  );
}
