import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { FaCheck } from 'react-icons/fa6';
import { RiEdit2Fill } from 'react-icons/ri';
import { formatTicketCode } from './formatTicketCode';
import styles from './IssuedTicketCardList.module.css';

export type TicketCardStatus =
  'valid' | 'cancelled' | 'used' | 'missing' | 'unknown';

export type TicketCardItem = {
  code: string;
  signature: string;
  serial?: number;
  lastOpenedAt?: number;
  performanceName: string;
  performanceTitle?: string | null;
  scheduleName: string;
  scheduleDate?: string;
  scheduleTime?: string;
  scheduleEndTime?: string;
  rehearsalEndAt?: string | null;
  isOfficialRehearsal?: boolean;
  ticketTypeLabel: string;
  relationshipName: string;
  ticketName?: string | null;
  issuerName?: string;
  status: TicketCardStatus;
};

export type TicketListSortMode = 'recent' | 'class' | 'performance';

type IssuedTicketCardListProps = {
  title?: string;
  tickets: TicketCardItem[];
  emptyMessage?: string;
  showTicketLink?: boolean;
  showTicketCode?: boolean;
  showSerialNumber?: boolean;
  embedded?: boolean;
  collapseAt?: number;
  showSortControl?: boolean;
  sortMode?: TicketListSortMode;
  onSortModeChange?: (mode: TicketListSortMode) => void;
  onTicketNameChange?: (
    ticket: TicketCardItem,
    name: string | null,
  ) => Promise<void>;
};

export const getTicketDisplayName = (
  ticket: Pick<
    TicketCardItem,
    'ticketName' | 'performanceName' | 'scheduleName' | 'serial'
  >,
): string =>
  ticket.ticketName?.trim() ||
  [
    ticket.performanceName,
    ticket.scheduleName,
    typeof ticket.serial === 'number' ? `#${ticket.serial}` : '',
  ]
    .filter(Boolean)
    .join(' ');

export const isEndedPerformanceTicket = (
  ticket: Pick<
    TicketCardItem,
    'scheduleDate' | 'scheduleEndTime' | 'rehearsalEndAt'
  >,
  now: Date | null,
): boolean => {
  if (!now) {
    return false;
  }

  if (ticket.rehearsalEndAt) {
    const endAt = new Date(ticket.rehearsalEndAt);
    return !Number.isNaN(endAt.getTime()) && endAt.getTime() <= now.getTime();
  }

  const date = ticket.scheduleDate?.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  const time = ticket.scheduleEndTime?.match(/^(\d{1,2}):(\d{2})$/);
  if (!date || !time) {
    return false;
  }

  const endAt = new Date(
    Number(date[1]),
    Number(date[2]) - 1,
    Number(date[3]),
    Number(time[1]),
    Number(time[2]),
  );
  return !Number.isNaN(endAt.getTime()) && endAt.getTime() <= now.getTime();
};

export const compareTicketCardItem = (
  a: TicketCardItem,
  b: TicketCardItem,
): number => {
  const groupCompare =
    a.performanceName.localeCompare(b.performanceName, 'ja') ||
    a.scheduleName.localeCompare(b.scheduleName, 'ja') ||
    a.relationshipName.localeCompare(b.relationshipName, 'ja') ||
    (a.issuerName ?? '').localeCompare(b.issuerName ?? '', 'ja') ||
    a.ticketTypeLabel.localeCompare(b.ticketTypeLabel, 'ja');

  if (groupCompare !== 0) {
    return groupCompare;
  }

  const aSerial =
    typeof a.serial === 'number' ? a.serial : Number.MAX_SAFE_INTEGER;
  const bSerial =
    typeof b.serial === 'number' ? b.serial : Number.MAX_SAFE_INTEGER;
  if (aSerial !== bSerial) {
    return aSerial - bSerial;
  }

  return a.code.localeCompare(b.code, 'ja');
};

export const compareTicketByPerformance = (
  a: TicketCardItem,
  b: TicketCardItem,
): number => {
  const groupCompare =
    a.scheduleName.localeCompare(b.scheduleName, 'ja') ||
    a.performanceName.localeCompare(b.performanceName, 'ja') ||
    a.relationshipName.localeCompare(b.relationshipName, 'ja') ||
    (a.issuerName ?? '').localeCompare(b.issuerName ?? '', 'ja') ||
    a.ticketTypeLabel.localeCompare(b.ticketTypeLabel, 'ja');

  if (groupCompare !== 0) {
    return groupCompare;
  }

  const aSerial =
    typeof a.serial === 'number' ? a.serial : Number.MAX_SAFE_INTEGER;
  const bSerial =
    typeof b.serial === 'number' ? b.serial : Number.MAX_SAFE_INTEGER;
  if (aSerial !== bSerial) {
    return aSerial - bSerial;
  }

  return a.code.localeCompare(b.code, 'ja');
};

const getScheduleStartTimestamp = (ticket: TicketCardItem): number | null => {
  const date = ticket.scheduleDate?.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  const time = ticket.scheduleTime?.match(/^(\d{1,2}):(\d{2})$/);
  if (!date || !time) {
    return null;
  }

  const startAt = new Date(
    Number(date[1]),
    Number(date[2]) - 1,
    Number(date[3]),
    Number(time[1]),
    Number(time[2]),
  ).getTime();
  return Number.isNaN(startAt) ? null : startAt;
};

export const compareTicketByScheduleTime = (
  a: TicketCardItem,
  b: TicketCardItem,
): number => {
  const aStartAt = getScheduleStartTimestamp(a);
  const bStartAt = getScheduleStartTimestamp(b);
  if (aStartAt !== null && bStartAt !== null && aStartAt !== bStartAt) {
    return aStartAt - bStartAt;
  }
  if (aStartAt !== null && bStartAt === null) {
    return -1;
  }
  if (aStartAt === null && bStartAt !== null) {
    return 1;
  }
  return compareTicketByPerformance(a, b);
};

export const compareTicketByRecentOpen = (
  a: TicketCardItem,
  b: TicketCardItem,
): number => {
  const aLastOpenedAt = typeof a.lastOpenedAt === 'number' ? a.lastOpenedAt : 0;
  const bLastOpenedAt = typeof b.lastOpenedAt === 'number' ? b.lastOpenedAt : 0;
  if (aLastOpenedAt !== bLastOpenedAt) {
    return bLastOpenedAt - aLastOpenedAt;
  }
  return 0;
};

const ticketTypeMarkerClass = (
  ticketTypeLabel: string,
  isOfficialRehearsal?: boolean,
): string | null => {
  if (ticketTypeLabel.includes('入場専用券')) {
    return styles.markerAdmissionOnly;
  }
  if (ticketTypeLabel.includes('クラス公演(リハーサル)')) {
    return isOfficialRehearsal
      ? styles.markerOfficialRehearsal
      : styles.markerRehearsal;
  }
  if (ticketTypeLabel.includes('クラス公演')) {
    return styles.markerClassSameDay;
  }
  if (ticketTypeLabel.includes('体育館公演')) {
    return styles.markerGym;
  }
  return null;
};

const IssuedTicketCardList = ({
  title,
  tickets,
  emptyMessage = '表示できるチケットがありません。',
  showTicketLink = true,
  showTicketCode = false,
  showSerialNumber = false,
  embedded = false,
  collapseAt,
  showSortControl = false,
  sortMode,
  onSortModeChange,
  onTicketNameChange,
}: IssuedTicketCardListProps) => {
  const [internalSortMode, setInternalSortMode] =
    useState<TicketListSortMode>('recent');
  const [expanded, setExpanded] = useState(false);
  const [collapsedMaxHeight, setCollapsedMaxHeight] = useState<number | null>(
    null,
  );
  const [isCollapsible, setIsCollapsible] = useState(false);
  const [editingTicketCode, setEditingTicketCode] = useState<string | null>(
    null,
  );
  const [ticketNameDraft, setTicketNameDraft] = useState('');
  const cardRefs = useRef<Array<HTMLElement | null>>([]);
  const resolvedSortMode = sortMode ?? internalSortMode;

  const handleSortModeChange = (nextMode: TicketListSortMode) => {
    if (!sortMode) {
      setInternalSortMode(nextMode);
    }
    onSortModeChange?.(nextMode);
  };

  const saveTicketName = (ticket: TicketCardItem) => {
    if (!onTicketNameChange) {
      return;
    }
    setEditingTicketCode(null);
    void onTicketNameChange(ticket, ticketNameDraft.trim() || null);
  };

  const sortedTickets = useMemo(() => {
    if (resolvedSortMode === 'recent') {
      return [...tickets].sort(compareTicketByRecentOpen);
    }
    if (resolvedSortMode === 'class') {
      return [...tickets].sort(compareTicketCardItem);
    }
    return [...tickets].sort(compareTicketByScheduleTime);
  }, [tickets, resolvedSortMode]);

  useEffect(() => {
    if (typeof collapseAt !== 'number') {
      setIsCollapsible(false);
      setCollapsedMaxHeight(null);
      return;
    }

    const calculateCollapsedState = () => {
      const cards = cardRefs.current.filter(
        (card): card is HTMLElement => card !== null,
      );

      if (cards.length === 0) {
        setIsCollapsible(false);
        setCollapsedMaxHeight(null);
        return;
      }

      const rowTops = [...new Set(cards.map((card) => card.offsetTop))].sort(
        (a, b) => a - b,
      );

      const nextCollapsible = rowTops.length > collapseAt;
      setIsCollapsible(nextCollapsible);

      if (!nextCollapsible || expanded) {
        setCollapsedMaxHeight(null);
        return;
      }

      const firstRowTop = rowTops[0];
      const firstHiddenRowTop = rowTops[collapseAt];
      const firstHiddenCard = cards.find(
        (card) => card.offsetTop === firstHiddenRowTop,
      );

      if (!firstHiddenCard) {
        setCollapsedMaxHeight(null);
        return;
      }

      const maxHeight =
        firstHiddenRowTop - firstRowTop + firstHiddenCard.offsetHeight / 2;

      setCollapsedMaxHeight(Math.max(maxHeight, 0));
    };

    calculateCollapsedState();

    window.addEventListener('resize', calculateCollapsedState);
    return () => {
      window.removeEventListener('resize', calculateCollapsedState);
    };
  }, [collapseAt, expanded, sortedTickets]);

  return (
    <section
      className={`${styles.issuedSection} ${
        embedded ? styles.issuedSectionEmbedded : ''
      }`}
    >
      {title && <h2 className={styles.issuedTitle}>{title}</h2>}
      {showSortControl && (
        <div className={styles.sortControlRow}>
          <label className={styles.sortLabel} htmlFor='ticket-list-sort'>
            並び替え
          </label>
          <select
            id='ticket-list-sort'
            className={styles.sortSelect}
            value={resolvedSortMode}
            onChange={(event) =>
              handleSortModeChange(
                event.currentTarget.value as TicketListSortMode,
              )
            }
          >
            <option value='recent'>最後に開いた順</option>
            <option value='class'>クラス順</option>
            <option value='performance'>公演順</option>
          </select>
        </div>
      )}
      {sortedTickets.length === 0 ? (
        <p className={styles.emptyState}>{emptyMessage}</p>
      ) : (
        <div
          className={`${styles.collapsible} ${
            isCollapsible && !expanded ? styles.collapsibleCollapsed : ''
          }`}
          style={
            isCollapsible && !expanded && collapsedMaxHeight !== null
              ? { maxHeight: `${collapsedMaxHeight}px` }
              : undefined
          }
        >
          <div className={styles.issuedGrid}>
            {sortedTickets.map((ticket, index) => {
              const isAdmissionOnly =
                ticket.ticketTypeLabel.includes('入場専用券');
              const headlineLabel = isAdmissionOnly
                ? '入場専用券'
                : ticket.performanceName;
              const isEditingName = editingTicketCode === ticket.code;
              const markerClass = ticketTypeMarkerClass(
                ticket.ticketTypeLabel,
                ticket.isOfficialRehearsal,
              );

              return (
                <article
                  className={styles.ticketCard}
                  key={ticket.code}
                  ref={(element) => {
                    cardRefs.current[index] = element;
                  }}
                >
                  {markerClass && (
                    <span
                      className={`${styles.ticketTypeMarker} ${markerClass}`}
                      aria-hidden='true'
                    />
                  )}
                  <div className={styles.ticketHeader}>
                    <div className={styles.ticketNameArea}>
                      {isEditingName ? (
                        <input
                          className={styles.ticketNameInput}
                          value={ticketNameDraft}
                          maxLength={100}
                          aria-label='チケット名'
                          autoFocus
                          onInput={(event) =>
                            setTicketNameDraft(event.currentTarget.value)
                          }
                          onBlur={() => saveTicketName(ticket)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              setEditingTicketCode(null);
                            }
                          }}
                        />
                      ) : (
                        <span className={styles.ticketNameValue}>
                          {getTicketDisplayName(ticket)}
                        </span>
                      )}
                      {onTicketNameChange && isEditingName && (
                        <button
                          type='button'
                          className={styles.ticketNameEditFinishButton}
                          aria-label='チケット名を保存'
                          onClick={() => saveTicketName(ticket)}
                        >
                          <FaCheck aria-hidden='true' />
                        </button>
                      )}
                      {onTicketNameChange && !isEditingName && (
                        <button
                          type='button'
                          className={styles.ticketNameEditButton}
                          aria-label='チケット名を編集'
                          onClick={() => {
                            setTicketNameDraft(getTicketDisplayName(ticket));
                            setEditingTicketCode(ticket.code);
                          }}
                        >
                          <RiEdit2Fill aria-hidden='true' />
                        </button>
                      )}
                    </div>
                    <h3
                      className={`${styles.ticketClass} ${ticket.status !== 'valid' ? styles.isInvalid : ''}`}
                    >
                      {headlineLabel}
                      {!isAdmissionOnly && ticket.performanceTitle && (
                        <span className={styles.ticketTitle}>
                          「{ticket.performanceTitle}」
                        </span>
                      )}
                    </h3>
                    <span
                      className={`${styles.ticketSchedule} ${ticket.status !== 'valid' ? styles.isInvalid : ''}`}
                    >
                      {ticket.scheduleName === '' ? '-' : ticket.scheduleName}
                    </span>
                    {showSerialNumber && typeof ticket.serial === 'number' && (
                      <span className={styles.serialBadge}>
                        #{ticket.serial}
                      </span>
                    )}
                  </div>
                  <div className={styles.ticketMeta}>
                    {showTicketCode && (
                      <div className={styles.ticketMetaRow}>
                        <span className={styles.ticketMetaLabel}>
                          チケットコード
                        </span>
                        <span
                          className={`${styles.ticketMetaValue} ${styles.ticketCodeValue}`}
                        >
                          {formatTicketCode(ticket.code)}
                        </span>
                      </div>
                    )}
                    <div className={styles.ticketMetaRow}>
                      <span className={styles.ticketMetaLabel}>券種</span>
                      <span className={styles.ticketMetaValue}>
                        {ticket.ticketTypeLabel}
                      </span>
                    </div>
                    <div className={styles.ticketMetaRow}>
                      <span className={styles.ticketMetaLabel}>間柄</span>
                      <span className={styles.ticketMetaValue}>
                        {ticket.relationshipName}
                      </span>
                    </div>
                  </div>
                  {showTicketLink && (
                    <a
                      href={`/t/${ticket.code}.${ticket.signature}`}
                      className={styles.ticketLinkButton}
                    >
                      チケットを表示
                    </a>
                  )}
                </article>
              );
            })}
          </div>
          {isCollapsible && !expanded && <div className={styles.fadeMask} />}
        </div>
      )}
      {isCollapsible && (
        <button
          type='button'
          className={styles.showMoreButton}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? '閉じる' : '続きを表示'}
        </button>
      )}
    </section>
  );
};

export default IssuedTicketCardList;
