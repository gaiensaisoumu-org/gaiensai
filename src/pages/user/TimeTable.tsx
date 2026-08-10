import { useMemo } from 'preact/hooks';
import { useTitle } from '../../hooks/useTitle';
import performancesSnapshot from '../../generated/performances-static.json';
import styles from '../../styles/sub-pages.module.css';
import TimeTableContent from '../../components/ui/TimeTableContent';
import Modal2 from '../../components/ui/Modal2';

// スケジュールデータの型（提示されたテーブル構造に準拠）
interface ClassSchedule {
  id: number;
  round_name: string;
  start_at: string;
}

interface GymPerformance {
  id: number;
  group_name: string;
  round_name: string;
  start_at: string;
  end_at: string;
}

type TimeTableSnapshot = {
  schedules?: ClassSchedule[];
  gymPerformances?: GymPerformance[];
  showLengthMinutes?: number;
};

const snapshot = performancesSnapshot as TimeTableSnapshot;

const TimeTable = () => {
  useTitle('タイムテーブル');
  const classSchedules = useMemo(
    () =>
      (snapshot.schedules ?? [])
        .filter((item) => item.start_at)
        .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()),
    [],
  );
  const gymPerformances = useMemo(
    () =>
      (snapshot.gymPerformances ?? [])
        .filter((item) => item.start_at && item.end_at)
        .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()),
    [],
  );
  const showLength = snapshot.showLengthMinutes || 45;

  return (
    <>
      <Modal2 />
      <h1 className={styles.pageTitle}>タイムテーブル</h1>
      <nav className={styles.pageNavigation} aria-label='関連ページ'>
        <a className={styles.openButton} href='/performances'>
          公演一覧を見る
        </a>
        <a className={styles.openButton} href='/availability'>
          公演空き状況を見る
        </a>
      </nav>
      {/* ─── タイムテーブルの呼び出し ─── */}
      <TimeTableContent
        classSchedules={classSchedules}
        gymPerformances={gymPerformances}
        showLength={showLength}
      />
    </>
  );
};

export default TimeTable;
