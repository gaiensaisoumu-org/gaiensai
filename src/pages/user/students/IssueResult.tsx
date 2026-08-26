import { useEffect, useState } from 'preact/hooks';
import TicketListContent from '../../../features/tickets/TicketListContent';
import { useDecodedSerialTickets } from '../../../features/tickets/useDecodedSerialTickets';

import {
  ISSUE_RESULT_STORAGE_KEY,
  type IssueResultPayload,
} from '../../../features/issue/issueResultStorage';
import styles from './Issue.module.css';
import BackButton from '../../../components/ui/BackButton';
import { useTicketStorage } from '../../../features/tickets/useTicketStorage';
import { useTitle } from '../../../hooks/useTitle';
import Alert from '../../../components/ui/Alert';

const IssueResult = () => {
  const [result, setResult] = useState<IssueResultPayload | null>(null);
  const { saveTicketToCache } = useTicketStorage();

  useTitle('発券完了 - 生徒用ページ');

  useEffect(() => {
    const raw = window.sessionStorage.getItem(ISSUE_RESULT_STORAGE_KEY);

    if (!raw) {
      setResult(null);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as IssueResultPayload;
      if (!parsed.issuedTickets || parsed.issuedTickets.length === 0) {
        setResult(null);
        return;
      }

      setResult(parsed);

      // Cache newly issued tickets to ticketDisplayCache
      void Promise.all(
        parsed.issuedTickets.map((ticket) =>
          saveTicketToCache(
            ticket.code,
            ticket.signature,
            {
              performanceName: parsed.performanceName,
              performanceTitle: parsed.performanceTitle ?? null,
              scheduleName: parsed.scheduleName,
              scheduleDate: parsed.scheduleDate,
              scheduleTime: parsed.scheduleTime,
              scheduleEndTime: parsed.scheduleEndTime,
              isOfficialRehearsal: parsed.isOfficialRehearsal,
              ticketTypeLabel: parsed.ticketTypeLabel,
              relationshipName: parsed.relationshipName,
              relationshipId: parsed.relationshipId,
            },
            'valid',
          ),
        ),
      );
    } catch {
      setResult(null);
    }
  }, []);

  const issuedTickets = useDecodedSerialTickets(result?.issuedTickets ?? []);

  return (
    <div className={styles.issuePage}>
      <BackButton href='/students/issue' />
      <h1 className={styles.pageTitle}>発券完了</h1>

      <Alert type='info' style={{ marginTop: '0' }}>
        発券したチケット一覧にある鉛筆マークから、チケット名を変更できます。チケットを区別しやすい名前に変更しよう!
      </Alert>

      {!result ? (
        <section className={styles.issuedSection}>
          <p>表示できる発券結果がありません。</p>
          <a href='/students/issue' className={styles.topBackButton}>
            発券画面へ戻る
          </a>
        </section>
      ) : (
        <section className={styles.issuedSection}>
          <TicketListContent
            title='発券したチケット一覧'
            showSortControl
            showSerialNumber
            showTicketCode
            emptyMessage='発券したチケットはありません。'
            tickets={issuedTickets.map((ticket) => ({
              ...ticket,
              performanceName: result.performanceName,
              performanceTitle: result.performanceTitle,
              scheduleName: result.scheduleName,
              ticketTypeLabel: result.ticketTypeLabel,
              relationshipName: result.relationshipName,
              isOfficialRehearsal: result.isOfficialRehearsal,
              status: 'valid',
            }))}
          />
        </section>
      )}

      <a href='/students/dashboard' className={styles.buttonLink}>
        ダッシュボードへ戻る
      </a>
    </div>
  );
};

export default IssueResult;
