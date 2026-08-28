import { useCallback, useEffect, useState } from 'preact/hooks';
import { FaMinus } from 'react-icons/fa6';
import Switch from '../../components/ui/Switch';
import {
  getPerformanceAvailability,
  subscribeMonitorPerformanceAvailability,
} from '../../features/performances/performanceAvailability';
import {
  getClassRemaining,
  getGymRemaining,
} from '../../features/performances/availabilityHelpers';
import {
  TICKETLESS_ENTRY_COUNTS_STORAGE_KEY,
  type ScanTarget,
} from './OrganizationEntryPage';
import styles from './OrganizationAttendanceCounter.module.css';

type ClassPerformance = {
  id: number;
  total_capacity: number | null;
  junior_capacity: number | null;
};

type GymPerformance = {
  id: number;
  capacity: number | null;
  junior_capacity: number | null;
};

type ClassCounter = {
  class_id: number;
  round_id: number;
  issued_general: number | null;
  issued_junior: number | null;
  issued_other: number | null;
};

type GymCounter = {
  performance_id: number;
  issued_general: number | null;
  issued_junior: number | null;
  issued_other: number | null;
};

const getTargetKey = (target: ScanTarget) =>
  `${target.kind}:${target.performanceId ?? 'none'}:${target.scheduleId ?? 'none'}`;
const TICKETED_ENTRY_COUNTS_STORAGE_KEY =
  'organization_entry_ticketed_counts:v1';
type CountKind = 'ticketed' | 'ticketless' | 'total';

const CounterPanel = ({
  kind,
  count,
  onIncrease,
  onDecrease,
}: {
  kind: CountKind;
  count: number;
  onIncrease: () => void;
  onDecrease: () => void;
}) => {
  const label =
    kind === 'ticketed'
      ? 'チケットあり'
      : kind === 'ticketless'
        ? 'チケットなし'
        : '入場者数（合計）';
  return (
    <section
      className={styles.counterPanel}
      onClick={onIncrease}
      aria-label={`${label}の入場者数。タップして1人増やす`}
    >
      <h2 className={styles.counterLabel}>{label}</h2>
      <p className={styles.count}>{count}人</p>
      <p className={styles.hint}>タップで1人追加</p>
      <button
        type='button'
        className={styles.decreaseButton}
        onClick={(event) => {
          event.stopPropagation();
          onDecrease();
        }}
        aria-label={`${label}の入場者数を1人減らす`}
      >
        <FaMinus /> 1人減らす
      </button>
    </section>
  );
};

const OrganizationAttendanceCounter = ({
  target,
  performanceName,
  roundName,
}: {
  target: ScanTarget;
  performanceName: string;
  roundName: string;
}) => {
  const [ticketedEntryCount, setTicketedEntryCount] = useState(0);
  const [ticketlessEntryCount, setTicketlessEntryCount] = useState(0);
  const [isSplitView, setIsSplitView] = useState(false);
  const [capacity, setCapacity] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const targetKey = getTargetKey(target);

  const readCount = (storageKey: string) => {
    try {
      const stored = JSON.parse(
        localStorage.getItem(storageKey) ?? '{}',
      ) as Record<string, { count?: unknown }>;
      const count = stored[targetKey]?.count;
      return Number.isSafeInteger(count) && Number(count) >= 0
        ? Number(count)
        : 0;
    } catch {
      return 0;
    }
  };

  useEffect(() => {
    setTicketedEntryCount(readCount(TICKETED_ENTRY_COUNTS_STORAGE_KEY));
    setTicketlessEntryCount(readCount(TICKETLESS_ENTRY_COUNTS_STORAGE_KEY));
  }, [targetKey]);

  const changeCount = useCallback(
    (kind: CountKind, delta: number) => {
      const storageKey =
        kind === 'ticketed'
          ? TICKETED_ENTRY_COUNTS_STORAGE_KEY
          : TICKETLESS_ENTRY_COUNTS_STORAGE_KEY;
      const setCount =
        kind === 'ticketed' ? setTicketedEntryCount : setTicketlessEntryCount;
      setCount((current) => {
        const count = Math.max(0, current + delta);
        try {
          const stored = JSON.parse(
            localStorage.getItem(storageKey) ?? '{}',
          ) as Record<string, unknown>;
          localStorage.setItem(
            storageKey,
            JSON.stringify({
              ...stored,
              [targetKey]: { count, updatedAt: new Date().toISOString() },
            }),
          );
        } catch {
          // Counting continues even if local storage is unavailable.
        }
        return count;
      });
    },
    [targetKey],
  );

  const decreaseTotalCount = useCallback(() => {
    // 合計表示では通常、チケットありの人数を増減する。チケットありが
    // 0 の場合は、合計を正しく減らせるようチケットなしを減らす。
    if (ticketedEntryCount > 0) {
      changeCount('ticketed', -1);
      return;
    }
    changeCount('ticketless', -1);
  }, [changeCount, ticketedEntryCount]);

  useEffect(() => {
    if (
      target.performanceId === null ||
      target.kind === 'rehearsal' ||
      (target.kind === 'class' && target.scheduleId === null)
    ) {
      setCapacity(null);
      setRemaining(null);
      return;
    }

    let isActive = true;
    const refresh = async () => {
      const result = await getPerformanceAvailability('monitor');
      if (!isActive || !result.data) {
        return;
      }

      if (target.kind === 'class') {
        const performance = (result.data.class_performances ?? []).find(
          (item): item is ClassPerformance =>
            typeof item === 'object' &&
            item !== null &&
            (item as ClassPerformance).id === target.performanceId,
        );
        const counter = (result.data.class_counters ?? []).find(
          (item): item is ClassCounter =>
            typeof item === 'object' &&
            item !== null &&
            (item as ClassCounter).class_id === target.performanceId &&
            (item as ClassCounter).round_id === target.scheduleId,
        );
        if (!performance) {
          setCapacity(null);
          setRemaining(null);
          return;
        }
        const totalCapacity = Number(performance.total_capacity ?? 0);
        setCapacity(totalCapacity);
        setRemaining(
          getClassRemaining({
            totalCapacity,
            juniorCapacity: Number(performance.junior_capacity ?? 0),
            issuedGeneral: Number(counter?.issued_general ?? 0),
            issuedJunior: Number(counter?.issued_junior ?? 0),
            issuedOther: Number(counter?.issued_other ?? 0),
            mode: 'total',
            isJuniorReleased: true,
          }),
        );
        return;
      }

      const performance = (result.data.gym_performances ?? []).find(
        (item): item is GymPerformance =>
          typeof item === 'object' &&
          item !== null &&
          (item as GymPerformance).id === target.performanceId,
      );
      const counter = (result.data.gym_counters ?? []).find(
        (item): item is GymCounter =>
          typeof item === 'object' &&
          item !== null &&
          (item as GymCounter).performance_id === target.performanceId,
      );
      if (!performance) {
        setCapacity(null);
        setRemaining(null);
        return;
      }
      const totalCapacity = Number(performance.capacity ?? 0);
      setCapacity(totalCapacity);
      setRemaining(
        getGymRemaining({
          totalCapacity,
          juniorCapacity: Number(performance.junior_capacity ?? 0),
          issuedGeneral: Number(counter?.issued_general ?? 0),
          issuedJunior: Number(counter?.issued_junior ?? 0),
          issuedOther: Number(counter?.issued_other ?? 0),
          mode: 'total',
          isJuniorReleased: true,
        }),
      );
    };

    void refresh();
    const unsubscribe = subscribeMonitorPerformanceAvailability(() => {
      void refresh();
    });
    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [target.kind, target.performanceId, target.scheduleId]);

  return (
    <main className={styles.page}>
      <header className={styles.status}>
        <strong className={styles.performanceName}>
          {performanceName} {roundName}
        </strong>
        <span>定員 {capacity ?? '-'}席</span>
        <span>空き枠 {remaining ?? '-'}席</span>
        <label className={styles.splitToggle}>
          2分割表示
          <Switch checked={isSplitView} onChange={setIsSplitView} />
        </label>
      </header>
      <div className={`${styles.counterArea} ${isSplitView ? styles.split : ''}`}>
        {isSplitView ? (
          <>
            <CounterPanel
              kind='ticketed'
              count={ticketedEntryCount}
              onIncrease={() => changeCount('ticketed', 1)}
              onDecrease={() => changeCount('ticketed', -1)}
            />
            <CounterPanel
              kind='ticketless'
              count={ticketlessEntryCount}
              onIncrease={() => changeCount('ticketless', 1)}
              onDecrease={() => changeCount('ticketless', -1)}
            />
          </>
        ) : (
          <CounterPanel
            kind='total'
            count={ticketedEntryCount + ticketlessEntryCount}
            onIncrease={() => changeCount('ticketed', 1)}
            onDecrease={decreaseTotalCount}
          />
        )}
      </div>
    </main>
  );
};

export default OrganizationAttendanceCounter;
