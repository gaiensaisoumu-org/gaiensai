import { useEffect, useMemo, useState } from 'preact/hooks';
import IssuedTicketCardList, {
  compareTicketByRecentOpen,
  compareTicketByScheduleTime,
  compareTicketCardItem,
  getTicketDisplayName,
  type TicketCardItem,
  type TicketListSortMode,
} from './IssuedTicketCardList';
import { supabase } from '../../lib/supabase';
import {
  readTicketDisplayCache,
  writeTicketDisplayCache,
} from './ticketDisplayCache';
import Switch from '../../components/ui/Switch';
import { MdFormatListBulleted, MdOutlineGridView } from 'react-icons/md';
import { formatTicketCode } from './formatTicketCode';
import styles from './TicketListContent.module.css';

export type TicketListDisplayOptionsValue = {
  groupByTicketType: boolean;
  performanceFilter: string;
  scheduleFilter: string;
  displayMode: 'card' | 'table';
};

export const defaultTicketListDisplayOptions: TicketListDisplayOptionsValue = {
  groupByTicketType: false,
  performanceFilter: '',
  scheduleFilter: '',
  displayMode: 'card',
};

const DISPLAY_OPTIONS_STORAGE_KEY = 'ticketList.displayOptions';
const SORT_MODE_STORAGE_KEY = 'ticketList.sortMode';

const readStoredDisplayOptions = (): TicketListDisplayOptionsValue => {
  try {
    const stored = JSON.parse(
      localStorage.getItem(DISPLAY_OPTIONS_STORAGE_KEY) ?? '{}',
    ) as Partial<TicketListDisplayOptionsValue>;
    return { ...defaultTicketListDisplayOptions, ...stored };
  } catch {
    return defaultTicketListDisplayOptions;
  }
};

export const useTicketListDisplayOptions = (): [
  TicketListDisplayOptionsValue,
  (value: TicketListDisplayOptionsValue) => void,
] => {
  const [value, setValue] = useState<TicketListDisplayOptionsValue>(
    readStoredDisplayOptions,
  );
  useEffect(() => {
    try {
      localStorage.setItem(DISPLAY_OPTIONS_STORAGE_KEY, JSON.stringify(value));
    } catch {
      /* Ignore storage errors */
    }
  }, [value]);
  return [value, setValue];
};

const readStoredSortMode = (): TicketListSortMode => {
  try {
    const value = localStorage.getItem(SORT_MODE_STORAGE_KEY);
    return value === 'class' || value === 'performance' || value === 'recent'
      ? value
      : 'recent';
  } catch {
    return 'recent';
  }
};

export const useTicketListSortMode = (): [
  TicketListSortMode,
  (value: TicketListSortMode) => void,
] => {
  const [value, setValue] = useState<TicketListSortMode>(readStoredSortMode);
  useEffect(() => {
    try {
      localStorage.setItem(SORT_MODE_STORAGE_KEY, value);
    } catch {
      /* Ignore storage errors */
    }
  }, [value]);
  return [value, setValue];
};

type TicketListContentProps = {
  title?: string;
  tickets: TicketCardItem[];
  loading?: boolean;
  error?: string | null;
  emptyMessage: string;
  showTicketLink?: boolean;
  embedded?: boolean;
  collapseAt?: number;
  showTicketCode?: boolean;
  showSerialNumber?: boolean;
  showSortControl?: boolean;
  showDisplayOptions?: boolean;
  displayOptions?: TicketListDisplayOptionsValue;
  onDisplayOptionsChange?: (value: TicketListDisplayOptionsValue) => void;
  sortMode?: TicketListSortMode;
  onSortModeChange?: (mode: TicketListSortMode) => void;
};

const TicketListContent = ({
  title,
  tickets,
  loading = false,
  error = null,
  emptyMessage,
  showTicketLink,
  embedded = true,
  collapseAt = 2,
  showTicketCode = true,
  showSerialNumber = true,
  showSortControl = false,
  showDisplayOptions = false,
  displayOptions,
  onDisplayOptionsChange,
  sortMode,
  onSortModeChange,
}: TicketListContentProps) => {
  const [ticketNameOverrides, setTicketNameOverrides] = useState<
    Record<string, string | null>
  >({});
  const [nameError, setNameError] = useState<string | null>(null);
  const [internalDisplayOptions, setInternalDisplayOptions] =
    useTicketListDisplayOptions();
  const [internalSortMode, setInternalSortMode] = useTicketListSortMode();
  const resolvedDisplayOptions = displayOptions ?? internalDisplayOptions;
  const resolvedSortMode = sortMode ?? internalSortMode;
  const setResolvedDisplayOptions = (value: TicketListDisplayOptionsValue) => {
    if (displayOptions) {
      onDisplayOptionsChange?.(value);
    } else {
      setInternalDisplayOptions(value);
    }
  };
  const { groupByTicketType, performanceFilter, scheduleFilter, displayMode } =
    resolvedDisplayOptions;
  const setResolvedSortMode = (value: TicketListSortMode) => {
    if (sortMode) {
      onSortModeChange?.(value);
    } else {
      setInternalSortMode(value);
    }
  };

  const displayTickets = useMemo(
    () =>
      tickets.map((ticket) =>
        Object.prototype.hasOwnProperty.call(ticketNameOverrides, ticket.code)
          ? { ...ticket, ticketName: ticketNameOverrides[ticket.code] }
          : ticket,
      ),
    [tickets, ticketNameOverrides],
  );

  const filteredTickets = useMemo(
    () =>
      displayTickets.filter(
        (ticket) =>
          (!performanceFilter ||
            ticket.performanceName === performanceFilter) &&
          (!scheduleFilter || ticket.scheduleName === scheduleFilter),
      ),
    [displayTickets, performanceFilter, scheduleFilter],
  );
  const groupedTickets = useMemo(() => {
    if (!groupByTicketType) {
      return [['', filteredTickets]] as Array<[string, TicketCardItem[]]>;
    }
    if (filteredTickets.length === 0) {
      return [['', []]] as Array<[string, TicketCardItem[]]>;
    }
    const groups = new Map<string, TicketCardItem[]>();
    filteredTickets.forEach((ticket) => {
      const group = groups.get(ticket.ticketTypeLabel) ?? [];
      group.push(ticket);
      groups.set(ticket.ticketTypeLabel, group);
    });
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'ja'));
  }, [filteredTickets, groupByTicketType]);

  const sortTickets = (items: TicketCardItem[]) => {
    if (resolvedSortMode === 'class') {
      return [...items].sort(compareTicketCardItem);
    }
    if (resolvedSortMode === 'performance') {
      return [...items].sort(compareTicketByScheduleTime);
    }
    return [...items].sort(compareTicketByRecentOpen);
  };

  const handleTicketNameChange = async (
    ticket: TicketCardItem,
    name: string | null,
  ) => {
    if (name !== null && name.length > 100) {
      setNameError('名前は100文字以内で入力してください。');
      return;
    }

    setNameError(null);
    const previousName = ticket.ticketName ?? null;
    setTicketNameOverrides((current) => ({
      ...current,
      [ticket.code]: name,
    }));
    const cached = readTicketDisplayCache<Record<string, unknown>>(ticket.code);
    if (cached) {
      writeTicketDisplayCache(ticket.code, { ...cached, ticketName: name });
    }

    const { error } = await supabase.rpc('set_ticket_name', {
      ticket_code: ticket.code,
      ticket_signature: ticket.signature,
      new_ticket_name: name,
    });
    if (error) {
      setNameError('チケット名の保存に失敗しました。');
      setTicketNameOverrides((current) => ({
        ...current,
        [ticket.code]: previousName,
      }));
      if (cached) {
        writeTicketDisplayCache(ticket.code, {
          ...cached,
          ticketName: previousName,
        });
      }
      return;
    }
  };

  if (loading) {
    return <p>読み込み中...</p>;
  }

  if (error) {
    return <p>{error}</p>;
  }

  return (
    <>
      {nameError && <p>{nameError}</p>}
      {showDisplayOptions && (
        <TicketListDisplayOptions
          tickets={displayTickets}
          value={resolvedDisplayOptions}
          onChange={setResolvedDisplayOptions}
          sortMode={showSortControl ? resolvedSortMode : undefined}
          onSortModeChange={showSortControl ? setResolvedSortMode : undefined}
        />
      )}
      {showSortControl && !showDisplayOptions && (
        <TicketListSortControl
          value={resolvedSortMode}
          onChange={setResolvedSortMode}
        />
      )}
      {groupedTickets.map(([ticketTypeLabel, grouped]) => (
        <section key={ticketTypeLabel || 'all'} className={styles.ticketGroup}>
          {groupByTicketType && ticketTypeLabel && <h3>{ticketTypeLabel}</h3>}
          {displayMode === 'card' ? (
            <IssuedTicketCardList
              title={ticketTypeLabel ? undefined : title}
              embedded={embedded}
              collapseAt={collapseAt}
              showTicketCode={showTicketCode}
              showTicketLink={showTicketLink}
              showSerialNumber={showSerialNumber}
              showSortControl={false}
              sortMode={resolvedSortMode}
              onSortModeChange={setResolvedSortMode}
              onTicketNameChange={handleTicketNameChange}
              tickets={grouped}
              emptyMessage={emptyMessage}
            />
          ) : (
            <TicketTable
              tickets={sortTickets(grouped)}
              emptyMessage={emptyMessage}
              showTicketLink={showTicketLink}
            />
          )}
        </section>
      ))}
    </>
  );
};

export const TicketListDisplayOptions = ({
  tickets,
  value,
  onChange,
  sortMode,
  onSortModeChange,
}: {
  tickets: TicketCardItem[];
  value: TicketListDisplayOptionsValue;
  onChange: (value: TicketListDisplayOptionsValue) => void;
  sortMode?: TicketListSortMode;
  onSortModeChange?: (value: TicketListSortMode) => void;
}) => {
  const performanceOptions = Array.from(
    new Set(tickets.map((ticket) => ticket.performanceName)),
  ).sort((a, b) => a.localeCompare(b, 'ja'));
  const scheduleOptions = Array.from(
    new Set(
      tickets
        .filter(
          (ticket) =>
            !value.performanceFilter ||
            ticket.performanceName === value.performanceFilter,
        )
        .map((ticket) => ticket.scheduleName)
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, 'ja'));

  return (
    <div className={styles.displayOptions}>
      <div className={styles.displayOptionsRow}>
        <div className={styles.toggleOption}>
          <span>券種ごとに分類</span>
          <Switch
            checked={value.groupByTicketType}
            onChange={(checked) =>
              onChange({
                ...value,
                groupByTicketType: checked,
              })
            }
          />
        </div>
        <div className={styles.selectOption}>
          <span>表示設定</span>
          <div
            className={styles.displayModeButtons}
            role='group'
            aria-label='表示設定'
          >
            <button
              type='button'
              className={
                value.displayMode === 'table'
                  ? styles.displayModeButtonActive
                  : styles.displayModeButton
              }
              aria-label='表形式で表示'
              aria-pressed={value.displayMode === 'table'}
              onClick={() => onChange({ ...value, displayMode: 'table' })}
            >
              <MdFormatListBulleted aria-hidden='true' />
            </button>
            <button
              type='button'
              className={
                value.displayMode === 'card'
                  ? styles.displayModeButtonActive
                  : styles.displayModeButton
              }
              aria-label='カード形式で表示'
              aria-pressed={value.displayMode === 'card'}
              onClick={() => onChange({ ...value, displayMode: 'card' })}
            >
              <MdOutlineGridView aria-hidden='true' />
            </button>
          </div>
        </div>
      </div>
      <div className={styles.displayOptionsRow}>
        <label className={styles.selectOption}>
          <span>公演クラス</span>
          <select
            className={styles.optionSelect}
            value={value.performanceFilter}
            onChange={(event) =>
              onChange({
                ...value,
                performanceFilter: event.currentTarget.value,
                scheduleFilter: '',
              })
            }
          >
            <option value=''>すべて</option>
            {performanceOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.selectOption}>
          <span>回</span>
          <select
            className={styles.optionSelect}
            value={value.scheduleFilter}
            onChange={(event) =>
              onChange({ ...value, scheduleFilter: event.currentTarget.value })
            }
          >
            <option value=''>すべて</option>
            {scheduleOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {sortMode && onSortModeChange && (
          <label className={styles.selectOption}>
            <span>並び替え</span>
            <select
              className={styles.optionSelect}
              value={sortMode}
              onChange={(event) =>
                onSortModeChange(
                  event.currentTarget.value as TicketListSortMode,
                )
              }
            >
              <option value='recent'>最後に開いた順</option>
              <option value='class'>クラス順</option>
              <option value='performance'>公演順</option>
            </select>
          </label>
        )}
      </div>
    </div>
  );
};

export const TicketListSortControl = ({
  value,
  onChange,
}: {
  value: TicketListSortMode;
  onChange: (value: TicketListSortMode) => void;
}) => (
  <div className={styles.sortOptions}>
    <label className={styles.selectOption}>
      <span>並び替え</span>
      <select
        className={styles.optionSelect}
        value={value}
        onChange={(event) =>
          onChange(event.currentTarget.value as TicketListSortMode)
        }
      >
        <option value='recent'>最後に開いた順</option>
        <option value='class'>クラス順</option>
        <option value='performance'>公演順</option>
      </select>
    </label>
  </div>
);

const TicketTable = ({
  tickets,
  emptyMessage,
  showTicketLink,
}: {
  tickets: TicketCardItem[];
  emptyMessage: string;
  showTicketLink?: boolean;
}) => {
  const [cancelledCodes, setCancelledCodes] = useState<Set<string>>(new Set());
  const [cancellingCode, setCancellingCode] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const visibleTickets = tickets.filter(
    (ticket) => !cancelledCodes.has(ticket.code),
  );

  const handleCancel = async (ticket: TicketCardItem) => {
    if (
      !window.confirm(
        'このチケットをキャンセルしますか？この操作は取り消せません。',
      )
    ) {
      return;
    }
    setCancelError(null);
    setCancellingCode(ticket.code);
    const { error } = await supabase.rpc('cancel_own_ticket_by_code', {
      p_code: ticket.code,
    });
    if (error) {
      setCancelError(`キャンセルに失敗しました: ${error.message}`);
      setCancellingCode(null);
      return;
    }
    const cached = readTicketDisplayCache<Record<string, unknown>>(ticket.code);
    if (cached) {
      writeTicketDisplayCache(ticket.code, { ...cached, status: 'cancelled' });
    }
    setCancelledCodes((current) => new Set(current).add(ticket.code));
    setCancellingCode(null);
  };

  const copyTicketUrl = async (ticket: TicketCardItem) => {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/t/${ticket.code}.${ticket.signature}`,
      );
      setCopiedCode(ticket.code);
    } catch {
      setCopyError('URLをコピーできませんでした。');
    }
  };

  if (visibleTickets.length === 0) {
    return <p>{emptyMessage}</p>;
  }
  return (
    <>
      {cancelError && <p className={styles.cancelError}>{cancelError}</p>}
      {copyError && <p className={styles.cancelError}>{copyError}</p>}
      <p className={styles.tableScrollHint}>表は横にスクロールできます。</p>
      <div className={styles.tableScroll}>
        <table className={styles.ticketTable}>
          <thead>
            <tr>
              <th>チケット名</th>
              <th>公演クラス</th>
              <th>回</th>
              <th>券種</th>
              <th>間柄</th>
              <th>チケットコード</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleTickets.map((ticket) => (
              <tr key={ticket.code}>
                <td>
                  {showTicketLink === false ? (
                    getTicketDisplayName(ticket)
                  ) : (
                    <a href={`/t/${ticket.code}.${ticket.signature}`}>
                      {getTicketDisplayName(ticket)}
                    </a>
                  )}
                </td>
                <td>{ticket.performanceName}</td>
                <td>{ticket.scheduleName || '-'}</td>
                <td>{ticket.ticketTypeLabel}</td>
                <td>{ticket.relationshipName}</td>
                <td>{formatTicketCode(ticket.code)}</td>
                <td>
                  {ticket.status === 'valid' ? (
                    <div className={styles.tableActions}>
                      <button
                        type='button'
                        className={styles.copyButton}
                        onClick={() => void copyTicketUrl(ticket)}
                      >
                        {copiedCode === ticket.code
                          ? 'コピーしました'
                          : 'URLをコピー'}
                      </button>
                      <button
                        type='button'
                        className={styles.cancelButton}
                        disabled={cancellingCode === ticket.code}
                        onClick={() => void handleCancel(ticket)}
                      >
                        {cancellingCode === ticket.code
                          ? 'キャンセル中...'
                          : 'キャンセル'}
                      </button>
                    </div>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};

export default TicketListContent;
