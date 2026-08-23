import { useEffect, useMemo, useState } from 'preact/hooks';
import { useTitle } from '../../hooks/useTitle';
import {
  preloadScanTicketMaster,
  type ScanTicketMaster,
} from '../../features/tickets/scanTicketMaster';
import OrganizationEntryPage, {
  SCAN_TARGET_STORAGE_KEY,
  type ScanTarget,
} from './OrganizationEntryPage';
import styles from './OrganizationScan.module.css';
import performancesSnapshot from '../../generated/performances-static.json';
import ScanLayout from '../../layout/ScanLayout';
import NormalSection from '../../components/ui/NormalSection';

type AutoSlot = { target: ScanTarget; label: string; start: Date; end: Date };
type OrganizationEntryMode = 'scan' | 'register';

const toTokyoDateKey = (timestamp: number) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp));

const readTargetFromQuery = (): ScanTarget | null => {
  const params = new URLSearchParams(window.location.search);
  const performanceId = Number(params.get('performanceId'));
  if (!Number.isSafeInteger(performanceId) || performanceId <= 0) {
    return null;
  }

  if (params.get('venue') === 'gym') {
    return { kind: 'gym', performanceId, scheduleId: null };
  }

  if (params.get('rehearsal') === '1') {
    const scheduleId = Number(params.get('scheduleId'));
    return {
      kind: 'rehearsal',
      performanceId,
      scheduleId:
        Number.isSafeInteger(scheduleId) && scheduleId >= 0 ? scheduleId : null,
    };
  }

  const scheduleId = Number(params.get('scheduleId'));
  return {
    kind: 'class',
    performanceId,
    scheduleId:
      Number.isSafeInteger(scheduleId) && scheduleId > 0 ? scheduleId : null,
  };
};

const hasAutoRoundQuery = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get('scheduleId') === 'auto' || params.get('auto') === '1';
};

const OrganizationScan = ({
  mode = 'scan',
}: {
  mode?: OrganizationEntryMode;
}) => {
  const isRegisterMode = mode === 'register';
  useTitle(
    isRegisterMode ? 'チケット使用 - 管理画面' : 'チケットスキャン - 管理画面',
  );
  const queryTarget = useMemo(readTargetFromQuery, []);
  const queryUsesAutoRound = useMemo(hasAutoRoundQuery, []);
  const isGymAutoQuery = useMemo(
    () =>
      new URLSearchParams(window.location.search).get('venue') === 'gym' &&
      !new URLSearchParams(window.location.search).get('performanceId'),
    [],
  );
  const [isReadyToScan, setIsReadyToScan] = useState(false);
  const [master, setMaster] = useState<ScanTicketMaster | null>(null);
  const [selection, setSelection] = useState<ScanTarget>({
    kind: 'class',
    performanceId: null,
    scheduleId: null,
  });
  const [isAutoMode, setIsAutoMode] = useState(true);
  const [autoSlotIndex, setAutoSlotIndex] = useState(0);
  const [isAutoScanning, setIsAutoScanning] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    setNow(Date.now());
  }, []);

  useEffect(() => {
    if (queryTarget) {
      localStorage.setItem(
        SCAN_TARGET_STORAGE_KEY,
        JSON.stringify(queryTarget),
      );
      // クラスは公演回未指定時、体育館は scheduleId=auto（または auto=1）
      // 指定時に、その対象の当日公演を自動で順番に受け付ける。
      setSelection(queryTarget);
      setIsAutoMode(
        queryTarget.kind === 'gym'
          ? queryUsesAutoRound
          : queryTarget.kind === 'rehearsal'
            ? false
            : queryTarget.scheduleId === null,
      );
      setIsReadyToScan(true);
    }

    void preloadScanTicketMaster()
      .then((nextMaster) => {
        setMaster(nextMaster);
        if (isGymAutoQuery) {
          setIsReadyToScan(true);
        }
      })
      .catch(() => setMaster(null));
  }, [isGymAutoQuery, queryTarget, queryUsesAutoRound]);

  const selectedGymPerformance = master?.gymPerformances.find(
    (performance) => performance.id === selection.performanceId,
  );
  const selectedClassPerformance = master?.performances.find(
    (performance) => performance.id === selection.performanceId,
  );
  const gymGroups = Array.from(
    new Map(
      (master?.gymPerformances ?? []).map((performance) => [
        performance.group_name,
        performance,
      ]),
    ).values(),
  );
  const canStart =
    (isGymAutoQuery || selection.performanceId !== null) &&
    (isAutoMode || selection.kind === 'gym' || selection.scheduleId !== null);
  const autoSlots = useMemo((): AutoSlot[] => {
    const todayInTokyo = toTokyoDateKey(now);
    if (isGymAutoQuery) {
      return performancesSnapshot.gymPerformances
        .map((performance) => ({
          target: {
            kind: 'gym' as const,
            performanceId: performance.id,
            scheduleId: null,
          },
          label: `${performance.group_name}・${performance.round_name}`,
          start: new Date(performance.start_at),
          end: new Date(performance.end_at),
        }))
        .filter((slot) => toTokyoDateKey(slot.start.getTime()) === todayInTokyo)
        .sort((a, b) => a.start.getTime() - b.start.getTime());
    }
    if (selection.performanceId === null) {
      return [];
    }
    if (selection.kind === 'gym') {
      return performancesSnapshot.gymPerformances
        .filter(
          (performance) =>
            performance.group_name === selectedGymPerformance?.group_name,
        )
        .map((performance) => ({
          target: {
            kind: 'gym' as const,
            performanceId: performance.id,
            scheduleId: null,
          },
          label: `${performance.group_name} ${performance.round_name}`,
          start: new Date(performance.start_at),
          end: new Date(performance.end_at),
        }))
        .filter((slot) => toTokyoDateKey(slot.start.getTime()) === todayInTokyo)
        .sort((a, b) => a.start.getTime() - b.start.getTime());
    }
    if (selection.kind === 'rehearsal') {
      return [];
    }
    return performancesSnapshot.schedules
      .map((schedule) => {
        const start = new Date(schedule.start_at);
        return {
          target: {
            kind: 'class' as const,
            performanceId: selection.performanceId,
            scheduleId: schedule.id,
          },
          label: `${selectedClassPerformance?.class_name ?? 'クラス'}・${schedule.round_name}`,
          start,
          end: new Date(
            start.getTime() + performancesSnapshot.showLengthMinutes * 60_000,
          ),
        };
      })
      .filter((slot) => toTokyoDateKey(slot.start.getTime()) === todayInTokyo)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [
    isGymAutoQuery,
    selection,
    selectedGymPerformance,
    selectedClassPerformance,
    now,
  ]);
  const activeAutoSlot = autoSlots[autoSlotIndex] ?? null;
  const entryTarget = activeAutoSlot?.target ?? selection;

  useEffect(() => {
    // 受付中は時刻更新で公演一覧が再計算されても、準備中へ戻さない。
    if (!isAutoMode || isAutoScanning) {
      return;
    }
    const currentTime = Date.now();
    const nextIndex = autoSlots.findIndex(
      (slot) => slot.end.getTime() > currentTime,
    );
    setAutoSlotIndex(nextIndex < 0 ? autoSlots.length : nextIndex);
    setIsAutoScanning(false);
  }, [isAutoMode, isAutoScanning, autoSlots]);

  useEffect(() => {
    if (!isAutoMode || !isAutoScanning || !activeAutoSlot) {
      return;
    }
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      setNow(now);
      if (now >= activeAutoSlot.end.getTime()) {
        setIsAutoScanning(false);
        setAutoSlotIndex((index) => index + 1);
      }
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [isAutoMode, isAutoScanning, activeAutoSlot]);

  if (isReadyToScan && (!isAutoMode || isAutoScanning)) {
    return (
      <ScanLayout>
        <OrganizationEntryPage
          key={`${entryTarget.kind}:${entryTarget.performanceId ?? 'none'}:${entryTarget.scheduleId ?? 'none'}`}
          mode={mode}
          isPerformanceInProgress={Boolean(
            activeAutoSlot && now >= activeAutoSlot.start.getTime(),
          )}
        />
      </ScanLayout>
    );
  }

  if (isReadyToScan && isAutoMode) {
    return (
      <ScanLayout>
        <div className={styles.spacer}></div>
        <main className={styles.preparingShell}>
          <h1
            className={`${styles.preparingTitle} ${
              !activeAutoSlot ? styles.preparingEndedTitle : ''
            }`}
          >
            {activeAutoSlot ? '準備中...' : '本日の公演は終了しました。'}
          </h1>
          <h2
            className={`${styles.nextPerformanceTitle} ${
              !activeAutoSlot ? styles.preparingEndedTitle : ''
            }`}
          >
            {activeAutoSlot
              ? `次の公演：${activeAutoSlot.label}`
              : 'ご来場いただきありがとうございました。'}
          </h2>
          {activeAutoSlot && (
            <button
              type='button'
              className={styles.preparingStartButton}
              onClick={() => {
                localStorage.setItem(
                  SCAN_TARGET_STORAGE_KEY,
                  JSON.stringify(activeAutoSlot.target),
                );
                setIsAutoScanning(true);
              }}
            >
              受付を開始
            </button>
          )}
        </main>
      </ScanLayout>
    );
  }

  return (
    <ScanLayout>
      <main className={styles.targetSelectionShell}>
        <NormalSection className={styles.targetSelectionCard}>
          <h2>{isRegisterMode ? '登録対象を選択' : 'スキャン対象を選択'}</h2>
          <p>
            受付するクラス公演・自主リハーサル・部活と、公演回を選択してください。
          </p>
          {!master ? (
            <p>公演情報を読み込んでいます...</p>
          ) : (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <label>
                <span>公演クラス・部活</span>
                <select
                  value={
                    selection.performanceId === null
                      ? ''
                      : selection.kind === 'gym'
                        ? `gym:${selectedGymPerformance?.group_name ?? ''}`
                        : `class:${selection.performanceId}`
                  }
                  onChange={(event) => {
                    const [kind, rawValue] =
                      event.currentTarget.value.split(':');
                    if (!rawValue) {
                      setSelection({
                        kind: 'class',
                        performanceId: null,
                        scheduleId: null,
                      });
                      return;
                    }
                    if (kind === 'gym') {
                      const performance = master.gymPerformances.find(
                        (item) => item.group_name === rawValue,
                      );
                      setSelection({
                        kind: 'gym',
                        performanceId: performance?.id ?? null,
                        scheduleId: null,
                      });
                      return;
                    }
                    setSelection({
                      kind: 'class',
                      performanceId: Number(rawValue),
                      scheduleId: null,
                    });
                  }}
                >
                  <option value=''>選択してください</option>
                  <optgroup label='クラス公演'>
                    {master.performances.map((performance) => (
                      <option
                        key={performance.id}
                        value={`class:${performance.id}`}
                      >
                        {performance.class_name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label='部活'>
                    {gymGroups.map((performance) => (
                      <option
                        key={performance.group_name}
                        value={`gym:${performance.group_name}`}
                      >
                        {performance.group_name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
              <label>
                <span>公演回</span>
                <select
                  value={
                    isAutoMode
                      ? 'auto'
                      : selection.kind === 'gym'
                        ? (selection.performanceId ?? '')
                        : selection.kind === 'rehearsal'
                          ? `rehearsal:${selection.scheduleId ?? ''}`
                          : (selection.scheduleId ?? '')
                  }
                  disabled={selection.performanceId === null}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (value === 'auto') {
                      setIsAutoMode(true);
                      return;
                    }
                    setIsAutoMode(false);
                    const isRehearsal = value.startsWith('rehearsal:');
                    const id = value
                      ? Number(value.replace('rehearsal:', ''))
                      : null;
                    setSelection(
                      selection.kind === 'gym'
                        ? { ...selection, performanceId: id }
                        : {
                            kind: isRehearsal ? 'rehearsal' : 'class',
                            performanceId: selection.performanceId,
                            scheduleId: id,
                          },
                    );
                  }}
                >
                  <option value=''>選択してください</option>
                  <option value='auto'>自動</option>
                  {selection.kind === 'gym'
                    ? master.gymPerformances
                        .filter(
                          (performance) =>
                            performance.group_name ===
                            selectedGymPerformance?.group_name,
                        )
                        .map((performance) => (
                          <option key={performance.id} value={performance.id}>
                            {performance.round_name}
                          </option>
                        ))
                    : [
                        ...master.schedules.map((schedule) => (
                          <option key={schedule.id} value={schedule.id}>
                            {schedule.round_name}
                          </option>
                        )),
                        ...master.rehearsals
                          .filter(
                            (rehearsal) =>
                              rehearsal.class_id === selection.performanceId,
                          )
                          .map((rehearsal) => (
                            <option
                              key={`rehearsal-${rehearsal.round_id}`}
                              value={`rehearsal:${rehearsal.round_id}`}
                            >
                              {rehearsal.round_name}（リハーサル）
                            </option>
                          )),
                      ]}
                </select>
              </label>
              <button
                type='button'
                className={styles.targetSelectionStartButton}
                disabled={!canStart}
                onClick={() => {
                  if (isAutoMode && activeAutoSlot) {
                    localStorage.setItem(
                      SCAN_TARGET_STORAGE_KEY,
                      JSON.stringify(activeAutoSlot.target),
                    );
                    setIsReadyToScan(true);
                    setIsAutoScanning(true);
                    return;
                  }
                  localStorage.setItem(
                    SCAN_TARGET_STORAGE_KEY,
                    JSON.stringify(selection),
                  );
                  setIsReadyToScan(true);
                }}
              >
                {isReadyToScan
                  ? '受付を開始'
                  : isRegisterMode
                    ? '登録を開始'
                    : 'スキャンを開始'}
              </button>
            </div>
          )}
        </NormalSection>
      </main>
    </ScanLayout>
  );
};

export default OrganizationScan;
