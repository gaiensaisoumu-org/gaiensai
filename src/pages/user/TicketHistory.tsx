import { useEffect, useMemo, useState } from 'preact/hooks';
import TicketListContent from '../../features/tickets/TicketListContent';
import Modal from '../../components/ui/Modal';
import {
  clearTicketHistoryCaches,
  listTicketDisplayCache,
  subscribeTicketDisplayCacheUpdated,
} from '../../features/tickets/ticketDisplayCache';
import type {
  TicketCardItem,
  TicketListSortMode,
} from '../../features/tickets/IssuedTicketCardList';
import { useDecodedSerialTickets } from '../../features/tickets/useDecodedSerialTickets';
import pageStyles from '../../styles/sub-pages.module.css';
import type { CachedTicketDisplay } from '../../types/types';
import { useTitle } from '../../hooks/useTitle';

const TicketHistory = () => {
  const [cacheVersion, setCacheVersion] = useState(0);
  const [isClearHistoryModalOpen, setIsClearHistoryModalOpen] =
    useState(false);
  const [validSortMode, setValidSortMode] = useState<TicketListSortMode>(() => {
    try {
      return (
        (localStorage.getItem(
          'ticketListSortMode.valid',
        ) as TicketListSortMode) || 'recent'
      );
    } catch {
      return 'recent';
    }
  });
  const [cancelledSortMode, setCancelledSortMode] =
    useState<TicketListSortMode>(() => {
      try {
        return (
          (localStorage.getItem(
            'ticketListSortMode.cancelled',
          ) as TicketListSortMode) || 'recent'
        );
      } catch {
        return 'recent';
      }
    });
  const [otherSortMode, setOtherSortMode] = useState<TicketListSortMode>(() => {
    try {
      return (
        (localStorage.getItem(
          'ticketListSortMode.other',
        ) as TicketListSortMode) || 'recent'
      );
    } catch {
      return 'recent';
    }
  });

  useTitle('チケット表示履歴');

  useEffect(() => {
    try {
      localStorage.setItem('ticketListSortMode.valid', validSortMode);
    } catch {
      // Ignore errors
    }
  }, [validSortMode]);

  useEffect(() => {
    try {
      localStorage.setItem('ticketListSortMode.cancelled', cancelledSortMode);
    } catch {
      // Ignore errors
    }
  }, [cancelledSortMode]);

  useEffect(() => {
    try {
      localStorage.setItem('ticketListSortMode.other', otherSortMode);
    } catch {
      // Ignore errors
    }
  }, [otherSortMode]);

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
    () => tickets.filter((ticket) => ticket.status === 'valid'),
    [tickets],
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
        <h2>有効なチケット</h2>
        <TicketListContent
          embedded={false}
          showSortControl
          sortMode={validSortMode}
          onSortModeChange={setValidSortMode}
          tickets={validTickets}
          emptyMessage='この端末で開いたことがある有効なチケットはまだありません。'
        />
      </section>
      <section>
        <h2>キャンセル済みチケット</h2>
        <TicketListContent
          embedded={false}
          showSortControl
          sortMode={cancelledSortMode}
          onSortModeChange={setCancelledSortMode}
          tickets={cancelledTickets}
          emptyMessage='この端末で開いたことがあるキャンセル済みチケットはまだありません。'
        />
      </section>
      <section>
        <h2>その他のチケット</h2>
        <TicketListContent
          embedded={false}
          showSortControl
          sortMode={otherSortMode}
          onSortModeChange={setOtherSortMode}
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
