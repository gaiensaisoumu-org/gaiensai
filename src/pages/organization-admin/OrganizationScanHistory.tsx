import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { FaMinus, FaPlus } from 'react-icons/fa6';
import { TbDownload } from 'react-icons/tb';
import { TiDelete } from 'react-icons/ti';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatTicketCode } from '../../features/tickets/formatTicketCode';
import {
  decodeTicketCodeWithEnv,
  toTicketDecodedDisplaySeed,
} from '../../features/tickets/ticketCodeDecode';
import {
  preloadScanTicketMaster,
  resolveScanTicketDisplay,
  type ResolvedScanTicketDisplay,
  type ScanTicketMaster,
} from '../../features/tickets/scanTicketMaster';
import baseStyles from '../../styles/sub-pages.module.css';
import styles from './OrganizationScanHistory.module.css';
import BackButton from '../../components/ui/BackButton';
import { YEAR_BITS } from '../../../supabase/functions/_shared/ticketDataType';
import { useTitle } from '../../hooks/useTitle';

type ActiveTab = 'records' | 'tickets' | 'summary';

type ScanRecord = {
  id: number;
  ticket_code: string;
  scanned_at: string;
  result: string;
  count: number;
};

type TicketRow = {
  id: string;
  used_at: string | null;
  count: number;
};

const SCAN_RECORDS_STORAGE_KEY = 'organization_entry_scan_records:v1';
const SCAN_RESULT_LABELS: Record<string, string> = {
  success: '成功',
  duplicate: '重複',
  reentry: '再入場',
  failed: 'エラー',
  unverified: '署名検証エラー',
  wrongYear: '年度確認エラー',
};

type DecodedTicketInfo = {
  relationshipId: number;
  ticketTypeId: number;
  performanceId: number;
  scheduleId: number;
  serial: number;
  affiliation: string;
  year: string;
  resolved: ResolvedScanTicketDisplay | null;
};

const TABS: Array<{ key: ActiveTab; label: string }> = [
  { key: 'records', label: '読み取り履歴' },
  { key: 'tickets', label: 'チケットごとの履歴' },
  { key: 'summary', label: 'サマリー' },
];

const toNormalizedTicketCode = (value: string) =>
  value.split('.')[0].replace(/-/g, '').trim();

const buildTicketRowsFromRecords = (records: ScanRecord[]): TicketRow[] => {
  const ticketMap = new Map<string, TicketRow>();

  records.forEach((record) => {
    if (!(record.result === 'success' || record.result === 'reentry')) {
      return;
    }

    const id = toNormalizedTicketCode(record.ticket_code);
    const existing = ticketMap.get(id);
    const scannedAt = record.scanned_at ?? null;
    const count = record.count ?? 1;

    if (!existing) {
      ticketMap.set(id, {
        id,
        used_at: scannedAt,
        count,
      });
      return;
    }

    const existingTime = existing.used_at
      ? new Date(existing.used_at).getTime()
      : 0;
    const currentTime = scannedAt ? new Date(scannedAt).getTime() : 0;

    ticketMap.set(id, {
      id,
      used_at: currentTime >= existingTime ? scannedAt : existing.used_at,
      count: Math.max(existing.count ?? 1, count),
    });
  });

  return [...ticketMap.values()].sort((a, b) => {
    const aTime = a.used_at ? new Date(a.used_at).getTime() : 0;
    const bTime = b.used_at ? new Date(b.used_at).getTime() : 0;
    return bTime - aTime;
  });
};

const formatDateTime = (value: string | null) => {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

const truncateAxisLabel = (value: string, max = 14) =>
  value.length > max ? `${value.slice(0, max)}…` : value;

const escapeCsvCell = (value: unknown) => {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : String(value);
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return `"${normalized.replace(/"/g, '""')}"`;
};

const buildCsv = (headers: string[], rows: Array<Array<unknown>>) => {
  const lines = [
    headers.map((header) => escapeCsvCell(header)).join(','),
    ...rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}`;
};

const downloadCsv = (fileName: string, csvText: string) => {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

const getExportTimestamp = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
};

const getDecodedTicketYear = (year: string | null | undefined) => {
  if (year === null || year === undefined) {
    return '-';
  }
  const nowYear = new Date().getFullYear();

  return nowYear - (nowYear % 2 ** Number(YEAR_BITS)) + Number(year);
};

const SUMMARY_TOOLTIP_PROPS = {
  contentStyle: {
    backgroundColor: 'var(--normal-section-bg-color)',
    border: '1px solid var(--table-border-color)',
    borderRadius: '10px',
    color: 'var(--main-text-color)',
  },
  labelStyle: {
    color: 'var(--heading-text-color)',
    fontWeight: 700,
  },
  itemStyle: {
    color: 'var(--main-text-color)',
  },
  cursor: {
    fill: 'color-mix(in srgb, var(--white) 10%, transparent)',
  },
};

const OrganizationScanHistory = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('records');
  const [records, setRecords] = useState<ScanRecord[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [decodedTicketMap, setDecodedTicketMap] = useState<
    Record<string, DecodedTicketInfo>
  >({});
  const [scanMaster, setScanMaster] = useState<ScanTicketMaster | null>(null);
  const [showDeleteLogModal, setShowDeleteLogModal] = useState(false);
  const [pendingDeleteLogId, setPendingDeleteLogId] = useState<number | null>(
    null,
  );

  const [entryCount, setEntryCount] = useState<number>(0);

  const recordsTableWrapperRef = useRef<HTMLDivElement>(null);
  const ticketsTableWrapperRef = useRef<HTMLDivElement>(null);

  useTitle('チケットスキャン履歴 - 管理画面');

  useEffect(() => {
    const wrappers = [
      recordsTableWrapperRef.current,
      ticketsTableWrapperRef.current,
    ].filter(Boolean) as HTMLDivElement[];

    if (wrappers.length === 0) {
      return;
    }

    const updateScrollState = (wrapper: HTMLDivElement) => {
      const { scrollLeft, scrollWidth, clientWidth } = wrapper;
      const isScrollable = scrollWidth > clientWidth;

      if (!isScrollable) {
        wrapper.removeAttribute('data-scroll-fade');
        return;
      }

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

    const updateAllScrollStates = () => {
      wrappers.forEach((wrapper) => updateScrollState(wrapper));
    };

    const cleanupHandlers: Array<() => void> = [];

    updateAllScrollStates();
    wrappers.forEach((wrapper) => {
      const onScroll = () => updateScrollState(wrapper);
      wrapper.addEventListener('scroll', onScroll);
      cleanupHandlers.push(() =>
        wrapper.removeEventListener('scroll', onScroll),
      );
    });
    window.addEventListener('resize', updateAllScrollStates);

    return () => {
      cleanupHandlers.forEach((cleanup) => cleanup());
      window.removeEventListener('resize', updateAllScrollStates);
    };
  }, [records, tickets, activeTab]);

  const refreshFromLocalStorage = () => {
    try {
      const raw = localStorage.getItem(SCAN_RECORDS_STORAGE_KEY);
      const parsed = raw
        ? (JSON.parse(raw) as { records?: ScanRecord[] })
        : null;
      const localRecords = Array.isArray(parsed?.records)
        ? parsed.records
            .filter(
              (record) =>
                record && Number.isSafeInteger(record.id) && record.id > 0,
            )
            .sort(
              (a, b) =>
                new Date(b.scanned_at).getTime() -
                new Date(a.scanned_at).getTime(),
            )
        : [];
      setRecords(localRecords);
      setTickets(buildTicketRowsFromRecords(localRecords));
      setEntryCount(
        localRecords
          .filter(
            (record) =>
              record.result === 'success' || record.result === 'reentry',
          )
          .reduce((total, record) => total + record.count, 0),
      );
    } catch {
      setRecords([]);
      setTickets([]);
      setEntryCount(0);
    }
  };

  useEffect(() => {
    refreshFromLocalStorage();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === SCAN_RECORDS_STORAGE_KEY) {
        refreshFromLocalStorage();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadMaster = async () => {
      try {
        const master = await preloadScanTicketMaster();
        if (!cancelled) {
          setScanMaster(master);
        }
      } catch {
        if (!cancelled) {
          setScanMaster(null);
        }
      }
    };

    loadMaster();

    return () => {
      cancelled = true;
    };
  }, []);

  const decodeTargets = useMemo(() => {
    const merged = new Set<string>();

    tickets.forEach((ticket) => {
      merged.add(toNormalizedTicketCode(ticket.id));
    });

    records.forEach((record) => {
      merged.add(toNormalizedTicketCode(record.ticket_code));
    });

    return [...merged].filter((value) => Boolean(value));
  }, [tickets, records]);

  useEffect(() => {
    let cancelled = false;

    const decodeTargetsAsync = async () => {
      if (decodeTargets.length === 0) {
        setDecodedTicketMap({});
        return;
      }

      const entries = await Promise.all(
        decodeTargets.map(async (code) => {
          try {
            const decodedRaw = await decodeTicketCodeWithEnv(code);
            const decoded = toTicketDecodedDisplaySeed(decodedRaw);

            if (!decoded) {
              return [code, null] as const;
            }

            return [
              code,
              {
                ...decoded,
                resolved: scanMaster
                  ? resolveScanTicketDisplay(decoded, scanMaster)
                  : null,
              },
            ] as const;
          } catch {
            return [code, null] as const;
          }
        }),
      );

      if (cancelled) {
        return;
      }

      const nextMap: Record<string, DecodedTicketInfo> = {};
      entries.forEach(([code, decoded]) => {
        if (decoded) {
          nextMap[code] = decoded;
        }
      });
      setDecodedTicketMap(nextMap);
    };

    decodeTargetsAsync();

    return () => {
      cancelled = true;
    };
  }, [decodeTargets, scanMaster]);

  const rows = useMemo(
    () =>
      records.map((record) => ({
        ...record,
        label: SCAN_RESULT_LABELS[record.result] ?? record.result,
        scannedAtLabel: formatDateTime(record.scanned_at),
      })),
    [records],
  );

  const ticketRows = useMemo(
    () =>
      tickets.map((ticket) => {
        const code = toNormalizedTicketCode(ticket.id);
        return {
          ...ticket,
          usedAtLabel: formatDateTime(ticket.used_at),
          code,
          decoded: decodedTicketMap[code] ?? null,
        };
      }),
    [tickets, decodedTicketMap],
  );

  const summary = useMemo(() => {
    const successCount = rows
      .filter((row) => row.result === 'success')
      .reduce((sum) => sum + 1, 0);
    const reentryCount = rows
      .filter((row) => row.result === 'reentry')
      .reduce((sum) => sum + 1, 0);
    const failedCount = rows
      .filter((row) => row.result !== 'success' && row.result !== 'reentry')
      .reduce((sum) => sum + 1, 0);

    const hourlyMap = new Map<string, number>();
    const classMap = new Map<string, number>();
    const performanceMap = new Map<string, number>();
    const scheduleMap = new Map<string, number>();
    const relationshipMap = new Map<string, number>();

    ticketRows.forEach((ticket) => {
      const date = ticket.used_at ? new Date(ticket.used_at) : null;
      if (date && !Number.isNaN(date.getTime())) {
        const key = `${String(date.getHours()).padStart(2, '0')}:00`;
        hourlyMap.set(key, (hourlyMap.get(key) ?? 0) + 1);
      }

      const decoded = ticket.decoded;
      const classKey = decoded?.resolved?.performanceName ?? '不明';
      const performanceKey = decoded?.resolved?.performanceTitle
        ? `${decoded.resolved.performanceName}「${decoded.resolved.performanceTitle}」`
        : (decoded?.resolved?.performanceName ?? '不明');
      const scheduleKey = decoded?.resolved?.scheduleName ?? '不明';
      const relationshipKey = decoded?.resolved?.relationshipName ?? '不明';

      classMap.set(classKey, (classMap.get(classKey) ?? 0) + 1);
      performanceMap.set(
        performanceKey,
        (performanceMap.get(performanceKey) ?? 0) + 1,
      );
      scheduleMap.set(scheduleKey, (scheduleMap.get(scheduleKey) ?? 0) + 1);
      relationshipMap.set(
        relationshipKey,
        (relationshipMap.get(relationshipKey) ?? 0) + 1,
      );
    });

    const toSortedEntries = (map: Map<string, number>, limit = 10) =>
      [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([label, count]) => ({ label, count }));

    const hourly = [...hourlyMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, count]) => ({ label, count }));

    return {
      successCount,
      failedCount,
      reentryCount,
      hourly,
      classStats: toSortedEntries(classMap),
      performanceStats: toSortedEntries(performanceMap),
      scheduleStats: toSortedEntries(scheduleMap),
      relationshipStats: toSortedEntries(relationshipMap),
    };
  }, [rows, ticketRows]);

  const handleRecordCountChange = (logId: number, delta: number) => {
    const nextRecords = records.map((record) =>
      record.id === logId
        ? { ...record, count: Math.max(1, (record.count ?? 1) + delta) }
        : record,
    );
    localStorage.setItem(
      SCAN_RECORDS_STORAGE_KEY,
      JSON.stringify({ records: nextRecords }),
    );
    refreshFromLocalStorage();
  };

  const requestDeleteLog = (logId: number) => {
    setPendingDeleteLogId(logId);
    setShowDeleteLogModal(true);
  };

  const handleDeleteLogConfirm = () => {
    if (pendingDeleteLogId === null) {
      return;
    }

    const nextRecords = records.filter(
      (record) => record.id !== pendingDeleteLogId,
    );
    localStorage.setItem(
      SCAN_RECORDS_STORAGE_KEY,
      JSON.stringify({ records: nextRecords }),
    );
    refreshFromLocalStorage();
    setShowDeleteLogModal(false);
    setPendingDeleteLogId(null);
  };

  const handleDeleteLogCancel = () => {
    setShowDeleteLogModal(false);
    setPendingDeleteLogId(null);
  };

  const handleExportRecordsCsv = () => {
    const headers = ['ID', 'チケットコード', '結果', '人数', '読み取り時刻'];
    const data = rows.map((record) => [
      record.id,
      record.ticket_code,
      record.label,
      record.count ?? 'なし',
      record.scannedAtLabel,
    ]);
    downloadCsv(
      `scan_records_${getExportTimestamp()}.csv`,
      buildCsv(headers, data),
    );
  };

  const handleExportTicketsCsv = () => {
    const headers = [
      'チケットID',
      '最終利用時刻',
      '券種',
      '発行者',
      'クラス',
      '公演名',
      '回',
      '間柄',
      'シリアル',
      '発行年',
      '人数',
    ];
    const data = ticketRows.map((ticket) => [
      ticket.id,
      ticket.usedAtLabel,
      ticket.decoded?.resolved?.ticketTypeLabel ?? '-',
      ticket.decoded?.affiliation ?? '-',
      ticket.decoded?.resolved?.performanceName ?? '-',
      ticket.decoded?.resolved?.performanceTitle
        ? ticket.decoded.resolved.performanceTitle
        : (ticket.decoded?.resolved?.performanceName ?? '-'),
      ticket.decoded?.resolved?.scheduleName ?? '-',
      ticket.decoded?.resolved?.relationshipName ?? '-',
      ticket.decoded?.serial ?? '-',
      getDecodedTicketYear(ticket.decoded?.year),
      ticket.count,
    ]);
    downloadCsv(
      `scan_tickets_${getExportTimestamp()}.csv`,
      buildCsv(headers, data),
    );
  };

  return (
    <div className={`${baseStyles.subPageShell} ${styles.pageShell}`}>
      <BackButton />
      <h1 className={baseStyles.pageTitle}>読み取り履歴</h1>
      <section className={styles.metaRow}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>データ保存先</span>
          <span className={styles.metaValue}>この端末のローカルストレージ</span>
        </div>
        <button
          type='button'
          className={styles.refreshButton}
          onClick={refreshFromLocalStorage}
        >
          更新
        </button>
      </section>
      <section className={styles.statsSection}>
        <div className={styles.statCard}>
          <p className={styles.statLabel}>現在の入場者数</p>
          <p className={styles.statValue}>{entryCount}人</p>
        </div>
      </section>

      <section className={styles.tabSection}>
        <div className={styles.tabList} role='tablist' aria-label='履歴タブ'>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type='button'
              role='tab'
              className={`${styles.tabButton} ${
                activeTab === tab.key ? styles.tabButtonActive : ''
              }`}
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'records' && (
          <section className={styles.tabContent}>
            {rows.length === 0 ? (
              <p className={styles.emptyText}>読み取り履歴がまだありません。</p>
            ) : (
              <>
                <div className={styles.tableToolbar}>
                  <p className={styles.scrollHint}>
                    ← 横にスクロールできます →
                  </p>
                  <button
                    type='button'
                    className={styles.exportButton}
                    onClick={handleExportRecordsCsv}
                  >
                    <TbDownload />
                    CSVエクスポート
                  </button>
                </div>
                <div
                  className={styles.tableWrapper}
                  ref={recordsTableWrapperRef}
                >
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.cellId}>ID</th>
                        <th>チケットコード</th>
                        <th>結果</th>
                        <th className={styles.cellCount}>人数</th>
                        <th>読み取り時刻</th>
                        <th className={styles.cellActions}>削除</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((record) => (
                        <tr key={record.id}>
                          <td className={styles.cellId}>{record.id}</td>
                          <td className={styles.cellCode}>
                            {formatTicketCode(record.ticket_code)}
                          </td>
                          <td>
                            <span
                              className={`${styles.resultBadge} ${
                                record.result === 'success'
                                  ? styles.resultSuccess
                                  : record.result === 'reentry'
                                    ? styles.resultReentry
                                    : record.result === 'duplicate'
                                      ? styles.resultDuplicate
                                      : styles.resultFailed
                              }`}
                            >
                              {record.label}
                            </span>
                          </td>
                          <td className={styles.cellCount}>
                            <div className={styles.count}>
                              {(record.result === 'success' ||
                                record.result === 'reentry') && (
                                <button
                                  type='button'
                                  className={styles.recordCountButton}
                                  onClick={() =>
                                    handleRecordCountChange(record.id, -1)
                                  }
                                  aria-label='人数を減らす'
                                >
                                  <FaMinus />
                                </button>
                              )}
                              {record.count ?? 'なし'}
                              {(record.result === 'success' ||
                                record.result === 'reentry') && (
                                <button
                                  type='button'
                                  className={styles.recordCountButton}
                                  onClick={() =>
                                    handleRecordCountChange(record.id, 1)
                                  }
                                  aria-label='人数を増やす'
                                >
                                  <FaPlus />
                                </button>
                              )}
                            </div>
                          </td>
                          <td>{record.scannedAtLabel}</td>
                          <td className={styles.cellActions}>
                            <button
                              type='button'
                              className={styles.deleteButton}
                              onClick={() => requestDeleteLog(record.id)}
                            >
                              <TiDelete />
                              削除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}

        {activeTab === 'tickets' && (
          <section className={styles.tabContent}>
            {ticketRows.length === 0 ? (
              <p className={styles.emptyText}>チケット履歴がまだありません。</p>
            ) : (
              <>
                <div className={styles.tableToolbar}>
                  <p className={styles.scrollHint}>
                    ← 横にスクロールできます →
                  </p>
                  <button
                    type='button'
                    className={styles.exportButton}
                    onClick={handleExportTicketsCsv}
                  >
                    <TbDownload />
                    CSVエクスポート
                  </button>
                </div>
                <div
                  className={styles.tableWrapper}
                  ref={ticketsTableWrapperRef}
                >
                  <table className={styles.tableWide}>
                    <thead>
                      <tr>
                        <th>チケットID</th>
                        <th>最終利用時刻</th>
                        <th>券種</th>
                        <th>発行者</th>
                        <th>クラス</th>
                        <th>公演名</th>
                        <th>回</th>
                        <th>間柄</th>
                        <th>シリアル</th>
                        <th>発行年</th>
                        <th>人数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ticketRows.map((ticket) => (
                        <tr key={ticket.id}>
                          <td className={styles.cellCode}>{ticket.id}</td>
                          <td>{ticket.usedAtLabel}</td>
                          <td>
                            {ticket.decoded?.resolved?.ticketTypeLabel ?? '-'}
                          </td>
                          <td>
                            {ticket.decoded?.affiliation === '1600'
                              ? '当日券ゲスト'
                              : (ticket.decoded?.affiliation ?? '-')}
                          </td>
                          <td>
                            {ticket.decoded?.resolved?.performanceName ?? '-'}
                          </td>
                          <td>
                            {ticket.decoded?.resolved?.performanceTitle
                              ? ticket.decoded.resolved.performanceTitle
                              : (ticket.decoded?.resolved?.performanceName ??
                                '-')}
                          </td>
                          <td>
                            {ticket.decoded?.resolved?.scheduleName ?? '-'}
                          </td>
                          <td>
                            {ticket.decoded?.resolved?.relationshipName ?? '-'}
                          </td>
                          <td>{ticket.decoded?.serial ?? '-'}</td>
                          <td>{getDecodedTicketYear(ticket.decoded?.year)}</td>
                          <td>{ticket.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}

        {activeTab === 'summary' && (
          <section className={styles.tabContent}>
            <div className={styles.summaryCards}>
              <div className={styles.summaryCard}>
                <p className={styles.summaryLabel}>成功</p>
                <p className={styles.summaryValue}>{summary.successCount}</p>
              </div>
              <div className={styles.summaryCard}>
                <p className={styles.summaryLabel}>失敗</p>
                <p className={styles.summaryValue}>{summary.failedCount}</p>
              </div>
              <div className={styles.summaryCard}>
                <p className={styles.summaryLabel}>再入場</p>
                <p className={styles.summaryValue}>{summary.reentryCount}</p>
              </div>
            </div>

            <div className={styles.summaryGrid}>
              <article className={styles.chartCard}>
                <h2 className={styles.chartTitle}>時間帯ごとの読み取り数</h2>
                {summary.hourly.length === 0 ? (
                  <p className={styles.emptyText}>時間帯データがありません。</p>
                ) : (
                  <div className={styles.chartCanvas}>
                    <ResponsiveContainer width='100%' height='100%'>
                      <BarChart
                        data={summary.hourly}
                        margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                      >
                        <defs>
                          <linearGradient
                            id='summaryBarGradient'
                            x1='0'
                            y1='0'
                            x2='1'
                            y2='0'
                          >
                            <stop
                              offset='0%'
                              stopColor='var(--summary-chart-start-color)'
                            />
                            <stop
                              offset='100%'
                              stopColor='var(--summary-chart-end-color)'
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray='3 3' />
                        <XAxis dataKey='label' />
                        <YAxis allowDecimals={false} />
                        <Tooltip {...SUMMARY_TOOLTIP_PROPS} />
                        <Bar dataKey='count' fill='url(#summaryBarGradient)' />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </article>
              <article className={styles.chartCard}>
                <h2 className={styles.chartTitle}>クラス別</h2>
                {summary.classStats.length === 0 ? (
                  <p className={styles.emptyText}>
                    クラス別データがありません。
                  </p>
                ) : (
                  <div className={styles.chartCanvas}>
                    <ResponsiveContainer width='100%' height='100%'>
                      <BarChart
                        data={summary.classStats}
                        margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                      >
                        <defs>
                          <linearGradient
                            id='summaryBarGradient'
                            x1='0'
                            y1='0'
                            x2='1'
                            y2='0'
                          >
                            <stop
                              offset='0%'
                              stopColor='var(--summary-chart-start-color)'
                            />
                            <stop
                              offset='100%'
                              stopColor='var(--summary-chart-end-color)'
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray='3 3' />
                        <XAxis
                          dataKey='label'
                          tickFormatter={(value: string) =>
                            truncateAxisLabel(value)
                          }
                        />
                        <YAxis allowDecimals={false} />
                        <Tooltip {...SUMMARY_TOOLTIP_PROPS} />
                        <Bar dataKey='count' fill='url(#summaryBarGradient)' />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </article>
              <article className={styles.chartCard}>
                <h2 className={styles.chartTitle}>公演回別</h2>
                {summary.scheduleStats.length === 0 ? (
                  <p className={styles.emptyText}>
                    公演回別データがありません。
                  </p>
                ) : (
                  <div className={styles.chartCanvas}>
                    <ResponsiveContainer width='100%' height='100%'>
                      <BarChart
                        data={summary.scheduleStats}
                        margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                      >
                        <defs>
                          <linearGradient
                            id='summaryBarGradient'
                            x1='0'
                            y1='0'
                            x2='1'
                            y2='0'
                          >
                            <stop
                              offset='0%'
                              stopColor='var(--summary-chart-start-color)'
                            />
                            <stop
                              offset='100%'
                              stopColor='var(--summary-chart-end-color)'
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray='3 3' />
                        <XAxis
                          dataKey='label'
                          tickFormatter={(value: string) =>
                            truncateAxisLabel(value)
                          }
                        />
                        <YAxis allowDecimals={false} />
                        <Tooltip {...SUMMARY_TOOLTIP_PROPS} />
                        <Bar dataKey='count' fill='url(#summaryBarGradient)' />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </article>
              <article className={styles.chartCard}>
                <h2 className={styles.chartTitle}>間柄別</h2>
                {summary.relationshipStats.length === 0 ? (
                  <p className={styles.emptyText}>間柄別データがありません。</p>
                ) : (
                  <div className={styles.chartCanvas}>
                    <ResponsiveContainer width='100%' height='100%'>
                      <BarChart
                        data={summary.relationshipStats}
                        margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                      >
                        <defs>
                          <linearGradient
                            id='summaryBarGradient'
                            x1='0'
                            y1='0'
                            x2='1'
                            y2='0'
                          >
                            <stop
                              offset='0%'
                              stopColor='var(--summary-chart-start-color)'
                            />
                            <stop
                              offset='100%'
                              stopColor='var(--summary-chart-end-color)'
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray='3 3' />
                        <XAxis dataKey='label' />
                        <YAxis allowDecimals={false} />
                        <Tooltip {...SUMMARY_TOOLTIP_PROPS} />
                        <Bar dataKey='count' fill='url(#summaryBarGradient)' />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </article>
            </div>
          </section>
        )}
      </section>

      {showDeleteLogModal && (
        <div className={styles.modalOverlay} onClick={() => undefined}>
          <div
            className={styles.modalContainer}
            role='dialog'
            aria-modal='true'
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modalContent}>
              <h2 className={styles.modalTitle}>読み取り履歴を削除</h2>
              <p className={styles.modalDescription}>
                この履歴を削除しますか?一度削除した履歴は戻せません。
              </p>
              <div className={styles.modalButtonGroup}>
                <button
                  type='button'
                  className={styles.modalSecondaryButton}
                  onClick={handleDeleteLogCancel}
                >
                  キャンセル
                </button>
                <button
                  type='button'
                  className={styles.modalPrimaryButton}
                  onClick={handleDeleteLogConfirm}
                >
                  削除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrganizationScanHistory;
