import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import styles from './PerformancesTable.module.css';
import { RiCircleLine, RiCloseLargeLine, RiTriangleLine } from 'react-icons/ri';
import { useLocation } from 'preact-iso';

import type { AvailableSeatSelection } from '../../types/types';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { withTimeout } from '../../utils/withTimeout';
import {
  getPerformanceAvailability,
  subscribeMonitorPerformanceAvailability,
  subscribePublicPerformanceAvailability,
  type AvailabilitySource,
} from './performanceAvailability';
import {
  getAvailabilityStatus,
  getCapacityForMode,
  getClassRemaining,
} from './availabilityHelpers';

type PerformanceRow = {
  id: number;
  class_name: string;
  total_capacity: number | null;
  junior_capacity: number | null;
};

type PerformanceSchedule = {
  id: number;
  round_name: string;
  start_at?: string | null;
};

type ClassTicketCounterRow = {
  class_id: number;
  round_id: number;
  issued_general: number | null;
  issued_junior: number | null;
  issued_other: number | null;
};

type PerformanceAvailabilityData = {
  class_performances?: Array<PerformanceRow & { is_accepting?: boolean }>;
  schedules?: Array<PerformanceSchedule & { is_active?: boolean }>;
  class_counters?: ClassTicketCounterRow[];
  config?: { junior_release_open?: boolean | null };
};

const PERFORMANCES_CACHE_KEY = 'performances-table-cache:v1';
const SUPABASE_RESPONSE_TIMEOUT_MS = 8000;
const DEFAULT_GRADE_FILTERS: Array<'1' | '2' | '3'> = ['1', '2', '3'];
const DEFAULT_DAY_FILTERS: Array<'1' | '2'> = ['1', '2'];

type PerformancesTableProps = {
  orientation?: 'classes-as-rows' | 'classes-as-columns';
  showFilters?: boolean;
  showLegend?: boolean;
  showScrollHint?: boolean;
  enableIssueJump?: boolean;
  issuePath?: string;
  onAvailableCellClick?: (selection: AvailableSeatSelection | null) => void;
  selectedCellKey?: string;
  remainingMode?: 'general' | 'total' | 'junior';
  showToggleRemainingMode?: boolean;
  restrictedClassName?: string | null;
  filterAccepting?: boolean;
  filterPerformanceAccepting?: boolean;
  scheduleFilter?: (
    scheduleId: number,
    roundName: string,
    startAt?: string | null,
  ) => boolean;
  hiddenPerformanceIds?: Set<number>;
  nonInteractivePerformanceIds?: Set<number>;
  availabilitySource?: AvailabilitySource;
  gradeFilters?: Array<'1' | '2' | '3'>;
  dayFilters?: Array<'1' | '2'>;
};

const PerformancesTable = ({
  orientation = 'classes-as-rows',
  showFilters = true,
  showLegend = true,
  showScrollHint = true,
  enableIssueJump = false,
  issuePath = '/students/issue',
  onAvailableCellClick,
  selectedCellKey,
  remainingMode = 'general',
  showToggleRemainingMode = false,
  restrictedClassName = null,
  filterAccepting = false,
  filterPerformanceAccepting = filterAccepting,
  scheduleFilter,
  hiddenPerformanceIds,
  nonInteractivePerformanceIds,
  availabilitySource = 'public',
  gradeFilters = DEFAULT_GRADE_FILTERS,
  dayFilters = DEFAULT_DAY_FILTERS,
}: PerformancesTableProps) => {
  const autoSelectedCellKeyRef = useRef<string | null>(null);
  const hasLoadedAvailabilityRef = useRef(false);
  const lastSuccessfulAvailabilityAtRef = useRef<number | null>(null);
  const [performances, setPerformances] = useState<PerformanceRow[]>([]);
  const [schedules, setSchedules] = useState<PerformanceSchedule[]>([]);
  const [selectedPerformanceId, setSelectedPerformanceId] = useState<
    number | 'all'
  >('all');
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | 'all'>(
    'all',
  );
  const [remainingSeatMap, setRemainingSeatMap] = useState<Map<string, number>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);
  const [availabilityRevision, setAvailabilityRevision] = useState(0);
  const [currentRemainingMode, setCurrentRemainingMode] = useState<
    'general' | 'junior' | 'total'
  >(remainingMode);

  const { route } = useLocation();

  const tableWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrentRemainingMode(remainingMode);
  }, [remainingMode]);

  useEffect(() => {
    if (availabilitySource !== 'monitor') {
      return;
    }
    return subscribeMonitorPerformanceAvailability(() => {
      setAvailabilityRevision((revision) => revision + 1);
    });
  }, [availabilitySource]);

  useEffect(() => {
    if (availabilitySource !== 'public') {
      return;
    }
    return subscribePublicPerformanceAvailability(() => {
      setAvailabilityRevision((revision) => revision + 1);
    });
  }, [availabilitySource]);

  useEffect(() => {
    const wrapper = tableWrapperRef.current;
    if (!wrapper) {
      return;
    }

    let rafId: number | null = null;

    const updateScrollState = () => {
      const { scrollLeft, scrollWidth, clientWidth } = wrapper;

      // スクロール可能かどうか判定
      const isScrollable = scrollWidth > clientWidth;

      if (!isScrollable) {
        wrapper.removeAttribute('data-scroll-fade');
        return;
      }

      // 端の判定（1px程度の誤差を許容）
      const isAtStart = scrollLeft <= 1;
      const isAtEnd = Math.abs(scrollWidth - clientWidth - scrollLeft) <= 1;

      if (isAtStart) {
        wrapper.setAttribute('data-scroll-fade', 'start');
      } else if (isAtEnd) {
        wrapper.setAttribute('data-scroll-fade', 'end');
      } else {
        wrapper.setAttribute('data-scroll-fade', 'middle');
      }
    };

    // 初期化とイベントリスナー設定
    updateScrollState();

    // 非表示→表示直後のレイアウト確定後にも再計測する
    rafId = window.requestAnimationFrame(updateScrollState);

    wrapper.addEventListener('scroll', updateScrollState);
    window.addEventListener('resize', updateScrollState);

    const resizeObserver = new ResizeObserver(() => {
      updateScrollState();
    });
    resizeObserver.observe(wrapper);

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }

      wrapper.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', updateScrollState);
      resizeObserver.disconnect();
    };
  }, [
    performances,
    schedules,
    remainingSeatMap,
    selectedPerformanceId,
    selectedScheduleId,
  ]);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      // A monitor keeps its current table visible while Realtime-triggered
      // resyncs run. Only the first fetch may show the loading UI.
      const isBackgroundRefresh = hasLoadedAvailabilityRef.current;
      const showMonitorRefreshFailure = () => {
        const lastSuccess = lastSuccessfulAvailabilityAtRef.current;
        const elapsedMinutes =
          lastSuccess === null
            ? 0
            : Math.floor((Date.now() - lastSuccess) / 60_000);
        setCacheNotice(
          `更新に失敗しました。${elapsedMinutes}分前の情報を表示しています。`,
        );
      };
      if (!isBackgroundRefresh) {
        setLoading(true);
        setErrorMessage(null);
        setCacheNotice(null);
      }

      // 日付ごとの関数フィルターは復元できないため除外する。ほかの条件は
      // キーに含め、別画面の結果が混ざらないようにする。
      const canUseCache = !scheduleFilter;
      const cacheKey = `${PERFORMANCES_CACHE_KEY}:${currentRemainingMode}:${filterAccepting ? 'accepting' : 'all'}:${encodeURIComponent(restrictedClassName ?? 'all')}:${gradeFilters.join('') || 'none'}:${dayFilters.join('') || 'none'}`;
      const restoreCache = () => {
        if (!canUseCache) {
          return false;
        }

        try {
          const raw = window.localStorage.getItem(cacheKey);
          if (!raw) {
            return false;
          }
          const cached = JSON.parse(raw) as {
            performances?: PerformanceRow[];
            schedules?: PerformanceSchedule[];
            remaining?: Array<[string, number]>;
          };
          if (
            !Array.isArray(cached.performances) ||
            !Array.isArray(cached.schedules) ||
            !Array.isArray(cached.remaining)
          ) {
            return false;
          }

          setPerformances(cached.performances);
          setSchedules(cached.schedules);
          setRemainingSeatMap(new Map(cached.remaining));
          setCacheNotice(
            '残席情報の取得が遅延しているため、前回の表示を使用しています。',
          );
          setLoading(false);
          return true;
        } catch {
          return false;
        }
      };

      let availabilityData: PerformanceAvailabilityData | null = null;
      let availabilityError: unknown;
      let usedCloudflareFallback = false;
      try {
        const result =
          availabilitySource === 'monitor'
            ? await getPerformanceAvailability(availabilitySource)
            : await withTimeout(
                getPerformanceAvailability(availabilitySource),
                SUPABASE_RESPONSE_TIMEOUT_MS,
              );
        availabilityData = result.data as PerformanceAvailabilityData | null;
        availabilityError = result.error;
        usedCloudflareFallback = result.usedCloudflareFallback === true;
      } catch {
        if (isBackgroundRefresh) {
          if (availabilitySource === 'monitor') {
            showMonitorRefreshFailure();
          }
          return;
        }
        if (isMounted && !restoreCache()) {
          setErrorMessage('公演空き状況の取得がタイムアウトしました。');
          setLoading(false);
        }
        return;
      }

      if (!isMounted) {
        return;
      }

      if (availabilityError && !availabilityData) {
        if (isBackgroundRefresh) {
          if (availabilitySource === 'monitor') {
            showMonitorRefreshFailure();
          }
          return;
        }
        setErrorMessage('公演空き状況の取得に失敗しました。');
        setLoading(false);
        return;
      }

      const loadedPerformances = (
        (availabilityData?.class_performances ?? []) as Array<
          PerformanceRow & { is_accepting?: boolean }
        >
      ).filter(
        (performance) =>
          (!filterPerformanceAccepting || performance.is_accepting === true) &&
          (!restrictedClassName ||
            performance.class_name === restrictedClassName) &&
          gradeFilters.some((grade) =>
            performance.class_name.startsWith(`${grade}-`),
          ),
      );
      const loadedSchedules = (
        (availabilityData?.schedules ?? []) as Array<
          PerformanceSchedule & { is_active?: boolean }
        >
      ).filter(
        (schedule) =>
          (!filterAccepting || schedule.is_active === true) &&
          dayFilters.some((day) =>
            schedule.round_name.startsWith(`${day}日目`),
          ) &&
          (!scheduleFilter ||
            scheduleFilter(
              schedule.id,
              schedule.round_name,
              schedule.start_at,
            )),
      );
      const counterData = availabilityData?.class_counters ?? [];
      const configData = availabilityData?.config ?? null;

      const isJuniorReleased = Boolean(configData?.junior_release_open);
      const counts = new Map<
        string,
        { general: number; junior: number; other: number }
      >();
      ((counterData as ClassTicketCounterRow[] | null) ?? []).forEach((row) => {
        const key = `${row.class_id}-${row.round_id}`;
        counts.set(key, {
          general: Number(row.issued_general ?? 0),
          junior: Number(row.issued_junior ?? 0),
          other: Number(row.issued_other ?? 0),
        });
      });

      const seatMap = new Map<string, number>();
      loadedSchedules.forEach((s) => {
        loadedPerformances.forEach((p) => {
          const key = `${p.id}-${s.id}`;
          const stat = counts.get(key) || {
            general: 0,
            junior: 0,
            other: 0,
          };

          seatMap.set(
            key,
            getClassRemaining({
              totalCapacity: p.total_capacity ?? 0,
              juniorCapacity: p.junior_capacity ?? 0,
              issuedGeneral: stat.general,
              issuedJunior: stat.junior,
              issuedOther: stat.other,
              mode: currentRemainingMode,
              isJuniorReleased,
            }),
          );
        });
      });

      if (!isMounted) {
        return;
      }

      setRemainingSeatMap(seatMap);
      setPerformances(loadedPerformances);
      setSchedules(loadedSchedules);
      hasLoadedAvailabilityRef.current = true;
      lastSuccessfulAvailabilityAtRef.current = Date.now();
      setCacheNotice(
        usedCloudflareFallback
          ? '更新に失敗したため、Cloudflare のキャッシュ情報を表示しています。'
          : null,
      );
      if (canUseCache) {
        try {
          window.localStorage.setItem(
            cacheKey,
            JSON.stringify({
              performances: loadedPerformances,
              schedules: loadedSchedules,
              remaining: [...seatMap.entries()],
            }),
          );
        } catch {
          // キャッシュ書き込み失敗は表示に影響させない
        }
      }
      setLoading(false);
    };

    void load();

    return () => {
      isMounted = false;
    };
  }, [
    currentRemainingMode,
    restrictedClassName,
    filterAccepting,
    scheduleFilter,
    availabilityRevision,
    availabilitySource,
    gradeFilters,
    dayFilters,
  ]);

  const statusByKey = useMemo(() => {
    const map = new Map<string, 'circle' | 'triangle' | 'cross'>();

    schedules.forEach((schedule) => {
      performances.forEach((performance) => {
        const key = `${performance.id}-${schedule.id}`;
        const remaining = Number(remainingSeatMap.get(key) ?? 0);
        const totalCapacity = Number(performance.total_capacity ?? 0);
        const juniorCapacity = Number(performance.junior_capacity ?? 0);
        map.set(
          key,
          getAvailabilityStatus(
            remaining,
            getCapacityForMode(
              totalCapacity,
              juniorCapacity,
              currentRemainingMode,
            ),
          ),
        );
      });
    });

    return map;
  }, [performances, schedules, remainingSeatMap, currentRemainingMode]);

  const filteredPerformances = useMemo(
    () =>
      performances.filter(
        (performance) =>
          !hiddenPerformanceIds?.has(performance.id) &&
          (selectedPerformanceId === 'all' ||
            performance.id === selectedPerformanceId),
      ),
    [performances, selectedPerformanceId, hiddenPerformanceIds],
  );

  const filteredSchedules = useMemo(
    () =>
      schedules.filter(
        (schedule) =>
          selectedScheduleId === 'all' || schedule.id === selectedScheduleId,
      ),
    [schedules, selectedScheduleId],
  );

  useEffect(() => {
    if (!onAvailableCellClick || enableIssueJump) {
      return;
    }

    // if table data has not yet been loaded, don't modify selection
    if (filteredPerformances.length === 0 || filteredSchedules.length === 0) {
      return;
    }

    if (selectedCellKey) {
      const [selectedPerformanceIdFromKey, selectedScheduleIdFromKey] =
        selectedCellKey.split('-').map(Number);
      const isSelectedPerformanceInFilter = filteredPerformances.some(
        (performance) => performance.id === selectedPerformanceIdFromKey,
      );
      const isSelectedScheduleInFilter = filteredSchedules.some(
        (schedule) => schedule.id === selectedScheduleIdFromKey,
      );

      if (!isSelectedPerformanceInFilter || !isSelectedScheduleInFilter) {
        autoSelectedCellKeyRef.current = null;
        onAvailableCellClick(null);
      }

      return;
    }

    const selectableCells: AvailableSeatSelection[] = [];

    for (const schedule of filteredSchedules) {
      for (const performance of filteredPerformances) {
        const key = `${performance.id}-${schedule.id}`;
        const remaining = Number(remainingSeatMap.get(key) ?? 0);

        if (remaining <= 0) {
          continue;
        }

        selectableCells.push({
          performanceId: performance.id,
          performanceName: performance.class_name,
          scheduleId: schedule.id,
          scheduleName: schedule.round_name,
          remaining,
        });
      }
    }

    if (selectableCells.length !== 1) {
      autoSelectedCellKeyRef.current = null;
      return;
    }

    const selection = selectableCells[0];
    const key = `${selection.performanceId}-${selection.scheduleId}`;

    if (selectedCellKey === key || autoSelectedCellKeyRef.current === key) {
      return;
    }

    autoSelectedCellKeyRef.current = key;
    onAvailableCellClick(selection);
  }, [
    enableIssueJump,
    filteredPerformances,
    filteredSchedules,
    onAvailableCellClick,
    remainingSeatMap,
    selectedCellKey,
  ]);

  const getMark = (status: 'circle' | 'triangle' | 'cross') => {
    if (status === 'cross') {
      return <RiCloseLargeLine />;
    }
    if (status === 'triangle') {
      return <RiTriangleLine />;
    }
    return <RiCircleLine />;
  };

  const getStatusClass = (status: 'circle' | 'triangle' | 'cross') => {
    switch (status) {
      case 'circle':
        return styles.statusCircle;
      case 'triangle':
        return styles.statusTriangle;
      case 'cross':
        return styles.statusCross;
    }
  };

  const handleAvailableCellClick = (
    selection: AvailableSeatSelection,
  ): void => {
    onAvailableCellClick?.(selection);

    if (!enableIssueJump) {
      return;
    }

    const searchParams = new URLSearchParams({
      performanceId: String(selection.performanceId),
      scheduleId: String(selection.scheduleId),
    });

    route(`${issuePath}?${searchParams.toString()}`);
  };

  const renderCell = (
    performance: PerformanceRow,
    schedule: PerformanceSchedule,
  ) => {
    const key = `${performance.id}-${schedule.id}`;
    const remaining = remainingSeatMap.get(key) ?? 0;
    const status = statusByKey.get(key) ?? 'cross';
    const canIssue =
      remaining > 0 && !nonInteractivePerformanceIds?.has(performance.id);
    const isInteractive =
      canIssue && (enableIssueJump || Boolean(onAvailableCellClick));
    const isSelected = selectedCellKey === key;

    return (
      <td
        className={`${styles.td} ${getStatusClass(status)} ${
          isInteractive ? styles.jumpableCell : ''
        } ${isInteractive ? styles.interactiveCell : ''} ${
          isSelected ? styles.selectedCell : ''
        }`}
        key={key}
        onClick={() => {
          if (!canIssue) {
            return;
          }
          handleAvailableCellClick({
            performanceId: performance.id,
            performanceName: performance.class_name,
            scheduleId: schedule.id,
            scheduleName: schedule.round_name,
            remaining,
          });
        }}
        onKeyDown={(event) => {
          if (!isInteractive || (event.key !== 'Enter' && event.key !== ' ')) {
            return;
          }
          event.preventDefault();
          handleAvailableCellClick({
            performanceId: performance.id,
            performanceName: performance.class_name,
            scheduleId: schedule.id,
            scheduleName: schedule.round_name,
            remaining,
          });
        }}
        tabIndex={isInteractive ? 0 : undefined}
        role={isInteractive ? 'button' : undefined}
        aria-label={
          isInteractive
            ? `${performance.class_name} ${schedule.round_name} 残り${remaining}席`
            : undefined
        }
      >
        <div className={styles.mark}>{getMark(status)}</div>
        <div className={styles.remaining}>残り{remaining}席</div>
      </td>
    );
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  if (errorMessage) {
    return <p>{errorMessage}</p>;
  }

  if (performances.length === 0 || schedules.length === 0) {
    return <p>表示できる公演データがありません。</p>;
  }

  if (filteredPerformances.length === 0 || filteredSchedules.length === 0) {
    return (
      <div className={styles.container}>
        {showFilters && <div className={styles.filters}>
          <label className={styles.filterLabel} htmlFor='class-filter'>
            クラス
            <select
              id='class-filter'
              className={styles.filterSelect}
              value={String(selectedPerformanceId)}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setSelectedPerformanceId(
                  value === 'all' ? 'all' : Number(value),
                );
              }}
            >
              <option value='all'>すべて</option>
              {performances.map((performance) => (
                <option key={performance.id} value={performance.id}>
                  {performance.class_name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.filterLabel} htmlFor='schedule-filter'>
            公演回
            <select
              id='schedule-filter'
              className={styles.filterSelect}
              value={String(selectedScheduleId)}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setSelectedScheduleId(value === 'all' ? 'all' : Number(value));
              }}
            >
              <option value='all'>すべて</option>
              {schedules.map((schedule) => (
                <option key={schedule.id} value={schedule.id}>
                  {schedule.round_name}
                </option>
              ))}
            </select>
          </label>
          {showToggleRemainingMode && (
            <label
              className={styles.filterLabel}
              htmlFor='remaining-mode-toggle'
            >
              中学生の残席も表示する
              <select
                id='remaining-mode-toggle'
                className={styles.filterSelect}
                value={currentRemainingMode}
                onChange={(event) =>
                  setCurrentRemainingMode(
                    event.currentTarget.value === 'total' ? 'total' : 'general',
                  )
                }
              >
                <option value='general'>招待券枠のみ</option>
                <option value='total'>招待券枠＋中学生枠</option>
              </select>
            </label>
          )}
        </div>}
        <p className={styles.emptyState}>該当するデータがありません。</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {cacheNotice && <p>{cacheNotice}</p>}
      {showFilters && <div className={styles.filters}>
        <label className={styles.filterLabel} htmlFor='class-filter'>
          クラス
          <select
            id='class-filter'
            className={styles.filterSelect}
            value={String(selectedPerformanceId)}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setSelectedPerformanceId(value === 'all' ? 'all' : Number(value));
            }}
          >
            <option value='all'>すべて</option>
            {performances.map((performance) => (
              <option key={performance.id} value={performance.id}>
                {performance.class_name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterLabel} htmlFor='schedule-filter'>
          公演回
          <select
            id='schedule-filter'
            className={styles.filterSelect}
            value={String(selectedScheduleId)}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setSelectedScheduleId(value === 'all' ? 'all' : Number(value));
            }}
          >
            <option value='all'>すべて</option>
            {schedules.map((schedule) => (
              <option key={schedule.id} value={schedule.id}>
                {schedule.round_name}
              </option>
            ))}
          </select>
        </label>

        {showToggleRemainingMode && (
          <label className={styles.filterLabel} htmlFor='remaining-mode-toggle'>
            残席表示対象
            <select
              id='remaining-mode-toggle'
              className={styles.filterSelect}
              value={currentRemainingMode}
              onChange={(event) =>
                setCurrentRemainingMode(
                  event.currentTarget.value as 'general' | 'junior' | 'total',
                )
              }
            >
              <option value='general'>招待券枠のみ</option>
              <option value='junior'>中学生のみ</option>
              <option value='total'>招待券枠＋中学生枠</option>
            </select>
          </label>
        )}
      </div>}
      {showLegend && (
        <div className={styles.legend}>
          <span className={`${styles.legendItem} ${styles.statusCircle}`}>
            ○ 余裕あり
          </span>
          <span className={`${styles.legendItem} ${styles.statusTriangle}`}>
            △ 残り10%以下
          </span>
          <span className={`${styles.legendItem} ${styles.statusCross}`}>
            × 売り切れ
          </span>
        </div>
      )}
      {showScrollHint && (
        <p className={styles.scrollHint}>← 横にスクロールできます →</p>
      )}
      <div className={styles.tableWrapper} ref={tableWrapperRef}>
        <table className={styles.table}>
          <thead>
            <tr className={styles.tr}>
              <th className={styles.th}>
                {orientation === 'classes-as-columns' ? '公演回' : 'クラス'}
              </th>
              {orientation === 'classes-as-columns'
                ? filteredPerformances.map((performance) => (
                    <th className={styles.th} key={performance.id}>
                      {performance.class_name}
                    </th>
                  ))
                : filteredSchedules.map((schedule) => (
                    <th className={styles.th} key={schedule.id}>
                      {schedule.round_name}
                    </th>
                  ))}
            </tr>
          </thead>
          <tbody>
            {orientation === 'classes-as-columns'
              ? filteredSchedules.map((schedule) => (
                  <tr key={schedule.id} className={styles.tr}>
                    <th className={styles.th}>{schedule.round_name}</th>
                    {filteredPerformances.map((performance) =>
                      renderCell(performance, schedule),
                    )}
                  </tr>
                ))
              : filteredPerformances.map((performance) => (
                  <tr key={performance.id} className={styles.tr}>
                    <th className={styles.th}>{performance.class_name}</th>
                    {filteredSchedules.map((schedule) =>
                      renderCell(performance, schedule),
                    )}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PerformancesTable;
