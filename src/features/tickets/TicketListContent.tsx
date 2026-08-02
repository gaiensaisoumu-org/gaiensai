import { useMemo, useState } from 'preact/hooks';
import IssuedTicketCardList, {
  type TicketCardItem,
  type TicketListSortMode,
} from './IssuedTicketCardList';
import { supabase } from '../../lib/supabase';
import {
  readTicketDisplayCache,
  writeTicketDisplayCache,
} from './ticketDisplayCache';

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
  sortMode,
  onSortModeChange,
}: TicketListContentProps) => {
  const [ticketNameOverrides, setTicketNameOverrides] = useState<
    Record<string, string | null>
  >({});
  const [nameError, setNameError] = useState<string | null>(null);

  const displayTickets = useMemo(
    () =>
      tickets.map((ticket) =>
        Object.prototype.hasOwnProperty.call(ticketNameOverrides, ticket.code)
          ? { ...ticket, ticketName: ticketNameOverrides[ticket.code] }
          : ticket,
      ),
    [tickets, ticketNameOverrides],
  );

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
      <IssuedTicketCardList
        title={title}
        embedded={embedded}
        collapseAt={collapseAt}
        showTicketCode={showTicketCode}
        showTicketLink={showTicketLink}
        showSerialNumber={showSerialNumber}
        showSortControl={showSortControl}
        sortMode={sortMode}
        onSortModeChange={onSortModeChange}
        onTicketNameChange={handleTicketNameChange}
        tickets={displayTickets}
        emptyMessage={emptyMessage}
      />
    </>
  );
};

export default TicketListContent;
