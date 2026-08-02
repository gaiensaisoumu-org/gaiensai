import { useEffect, useState } from 'preact/hooks';
import BackButton from '../../../components/ui/BackButton';
import {
  JUNIOR_ISSUE_RESULT_STORAGE_KEY,
  type IssueResultPayload,
} from '../../../features/issue/issueResultStorage';
import TicketListContent from '../../../features/tickets/TicketListContent';
import { useDecodedSerialTickets } from '../../../features/tickets/useDecodedSerialTickets';
import { useTicketStorage } from '../../../features/tickets/useTicketStorage';
import { useTitle } from '../../../hooks/useTitle';
import { supabase } from '../../../lib/supabase';
import { readCachedJuniorProfile } from './offlineCache';
import styles from '../students/Issue.module.css';

type JuniorRelationshipSeed = {
  relationshipId: number;
  relationshipName: string;
};

const EMPTY_ISSUED_TICKETS: Array<{ code: string; signature: string }> = [];

const resolveJuniorRelationshipByUsageType = (
  juniorUsageType: number,
  index: number,
): JuniorRelationshipSeed | null => {
  switch (juniorUsageType) {
    case 0:
      return { relationshipId: 2, relationshipName: '中学生と保護者' };
    case 1:
      return index % 2 === 0
        ? { relationshipId: 0, relationshipName: '中学生' }
        : { relationshipId: 1, relationshipName: '保護者' };
    case 2:
      return { relationshipId: 0, relationshipName: '中学生' };
    case 3:
      return { relationshipId: 1, relationshipName: '保護者' };
    default:
      return null;
  }
};

const IssueResult = () => {
  const [result, setResult] = useState<IssueResultPayload | null>(null);
  const { saveTicketToCache } = useTicketStorage();
  // undefined: still loading from localStorage, null: not available
  const [juniorUsageType, setJuniorUsageType] = useState<
    number | null | undefined
  >(undefined);

  useTitle('発券完了 - 中学生用ページ');

  useEffect(() => {
    const loadJuniorUsageType = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) {
          setJuniorUsageType(null);
          return;
        }
        const cachedProfile = readCachedJuniorProfile(userId);
        const usageType = cachedProfile?.junior_usage_type;
        setJuniorUsageType(
          typeof usageType === 'number' && Number.isInteger(usageType)
            ? usageType
            : null,
        );
      } catch {
        setJuniorUsageType(null);
      }
    };

    void loadJuniorUsageType();
  }, []);

  useEffect(() => {
    const raw = window.sessionStorage.getItem(JUNIOR_ISSUE_RESULT_STORAGE_KEY);
    if (!raw) {
      setResult(null);
      return;
    }

    // Ensure relationship labels are computed from localStorage-derived usage type.
    if (juniorUsageType === undefined) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as IssueResultPayload;
      if (!parsed.issuedTickets || parsed.issuedTickets.length === 0) {
        setResult(null);
        return;
      }

      setResult(parsed);

      void Promise.all(
        parsed.issuedTickets.map((ticket, index) => {
          const computed =
            typeof juniorUsageType === 'number'
              ? resolveJuniorRelationshipByUsageType(juniorUsageType, index)
              : null;

          return saveTicketToCache(
            ticket.code,
            ticket.signature,
            {
              performanceName: parsed.performanceName,
              performanceTitle: parsed.performanceTitle ?? null,
              scheduleName: parsed.scheduleName,
              scheduleDate: parsed.scheduleDate,
              scheduleTime: parsed.scheduleTime,
              scheduleEndTime: parsed.scheduleEndTime,
              ticketTypeLabel: parsed.ticketTypeLabel,
              relationshipName:
                computed?.relationshipName ?? parsed.relationshipName,
              relationshipId: computed?.relationshipId ?? parsed.relationshipId,
            },
            'valid',
          );
        }),
      );
    } catch {
      setResult(null);
    }
  }, [juniorUsageType]);

  const issuedTickets = useDecodedSerialTickets(
    result?.issuedTickets ?? EMPTY_ISSUED_TICKETS,
  );

  return (
    <div className={styles.issuePage}>
      <BackButton href='/junior/issue' />
      <h1 className={styles.pageTitle}>発券完了</h1>

      {!result ? (
        <section className={styles.issuedSection}>
          <p>表示できる発券結果がありません。</p>
          <a href='/junior/issue' className={styles.topBackButton}>
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
            tickets={issuedTickets.map((ticket, index) => {
              const computed =
                typeof juniorUsageType === 'number'
                  ? resolveJuniorRelationshipByUsageType(juniorUsageType, index)
                  : null;

              return {
                ...ticket,
                performanceName: result.performanceName,
                performanceTitle: result.performanceTitle,
                scheduleName: result.scheduleName,
                ticketTypeLabel: result.ticketTypeLabel,
                relationshipName:
                  computed?.relationshipName ?? result.relationshipName,
                status: 'valid',
              };
            })}
          />
        </section>
      )}

      <a href='/junior/mypage' className={styles.buttonLink}>
        ダッシュボードへ戻る
      </a>
    </div>
  );
};

export default IssueResult;
