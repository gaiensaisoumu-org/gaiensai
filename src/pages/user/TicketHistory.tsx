import { useEffect, useMemo, useState } from 'preact/hooks';
import TicketListContent, {
  TicketListDisplayOptions,
  useTicketListDisplayOptions,
  useTicketListSortMode,
} from '../../features/tickets/TicketListContent';
import Modal from '../../components/ui/Modal';
import {
  clearTicketHistoryCaches,
  listTicketDisplayCache,
  subscribeTicketDisplayCacheUpdated,
} from '../../features/tickets/ticketDisplayCache';
import {
  isEndedPerformanceTicket,
  type TicketCardItem,
} from '../../features/tickets/IssuedTicketCardList';
import { useDecodedSerialTickets } from '../../features/tickets/useDecodedSerialTickets';
import pageStyles from '../../styles/sub-pages.module.css';
import type { CachedTicketDisplay } from '../../types/types';
import { useTitle } from '../../hooks/useTitle';

const TicketHistory = () => {
  const [cacheVersion, setCacheVersion] = useState(0);
  const [currentTime, setCurrentTime] = useState<Date | null>(null);
  const [isClearHistoryModalOpen, setIsClearHistoryModalOpen] = useState(false);
  const [ticketDisplayOptions, setTicketDisplayOptions] =
    useTicketListDisplayOptions();
  const [ticketSortMode, setTicketSortMode] = useTicketListSortMode();

  useTitle('チケット表示履歴');

  useEffect(() => {
    const updateCurrentTime = () => setCurrentTime(new Date());
    updateCurrentTime();
    const intervalId = window.setInterval(updateCurrentTime, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const refresh = () => setCacheVersion((previous) => previous + 1);
    const unsubscribe = subscribeTicketDisplayCacheUpdated(() => {
      refresh();
    });
    window.addEventListener('storage', refresh);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const cachedTickets = useMemo(
    () => listTicketDisplayCache<CachedTicketDisplay>(),
    [cacheVersion],
  );
  const tickets = useDecodedSerialTickets<TicketCardItem>(cachedTickets);
  const validTickets = useMemo(
    () =>
      tickets.filter(
        (ticket) =>
          ticket.status === 'valid' &&
          !isEndedPerformanceTicket(ticket, currentTime),
      ),
    [tickets, currentTime],
  );
  const endedPerformanceTickets = useMemo(
    () =>
      tickets.filter(
        (ticket) =>
          ticket.status === 'valid' &&
          isEndedPerformanceTicket(ticket, currentTime),
      ),
    [tickets, currentTime],
  );
  const cancelledTickets = useMemo(
    () => tickets.filter((ticket) => ticket.status === 'cancelled'),
    [tickets],
  );
  const otherTickets = useMemo(
    () =>
      tickets.filter(
        (ticket) => ticket.status !== 'valid' && ticket.status !== 'cancelled',
      ),
    [tickets],
  );

  const handleClearHistory = () => {
    clearTicketHistoryCaches();
    setIsClearHistoryModalOpen(false);
  };

  return (
    <>
      <h1 className={pageStyles.pageTitle}>チケット表示履歴</h1>
      <div className={pageStyles.buttonContainerLeft}>
        <button
          type='button'
          className={pageStyles.removeButton}
          onClick={() => setIsClearHistoryModalOpen(true)}
          disabled={tickets.length === 0}
        >
          履歴を消去
        </button>
      </div>
      <section>
        <h2>表示設定</h2>
        <TicketListDisplayOptions
          tickets={tickets}
          value={ticketDisplayOptions}
          onChange={setTicketDisplayOptions}
          sortMode={ticketSortMode}
          onSortModeChange={setTicketSortMode}
        />
      </section>
      <section>
        <h2>有効なチケット</h2>
        <TicketListContent
          embedded={false}
          displayOptions={ticketDisplayOptions}
          onDisplayOptionsChange={setTicketDisplayOptions}
          sortMode={ticketSortMode}
          onSortModeChange={setTicketSortMode}
          tickets={validTickets}
          emptyMessage='この端末で開いたことがある有効なチケットはまだありません。'
        />
      </section>
      <section>
        <h2>終了済み</h2>
        <TicketListContent
          embedded={false}
          displayOptions={ticketDisplayOptions}
          onDisplayOptionsChange={setTicketDisplayOptions}
          sortMode={ticketSortMode}
          onSortModeChange={setTicketSortMode}
          tickets={endedPerformanceTickets}
          emptyMessage='終了済みの公演チケットはまだありません。'
        />
      </section>
      <section>
        <h2>キャンセル済みチケット</h2>
        <TicketListContent
          embedded={false}
          displayOptions={ticketDisplayOptions}
          onDisplayOptionsChange={setTicketDisplayOptions}
          sortMode={ticketSortMode}
          onSortModeChange={setTicketSortMode}
          tickets={cancelledTickets}
          emptyMessage='この端末で開いたことがあるキャンセル済みチケットはまだありません。'
        />
      </section>
      <section>
        <h2>その他のチケット</h2>
        <TicketListContent
          embedded={false}
          displayOptions={ticketDisplayOptions}
          onDisplayOptionsChange={setTicketDisplayOptions}
          sortMode={ticketSortMode}
          onSortModeChange={setTicketSortMode}
          tickets={otherTickets}
          emptyMessage='この端末で開いたことがあるその他のチケットはまだありません。'
        />
      </section>
      {isClearHistoryModalOpen ? (
        <Modal
          setIsOpen={setIsClearHistoryModalOpen}
          handleAction={handleClearHistory}
          headingText='履歴を消去しますか？'
          buttonText='消去する'
        >
          <p>チケットはキャンセルされません。</p>
        </Modal>
      ) : null}
    </>
  );
};

export default TicketHistory;
