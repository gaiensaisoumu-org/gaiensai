import { useEffect, useMemo, useState } from 'preact/hooks';
import { supabase } from '../../../lib/supabase';
import performancesSnapshot from '../../../generated/performances-static.json';
import {
  decodeTicketCodeWithEnv,
  toTicketDecodedDisplaySeed,
} from '../../../features/tickets/ticketCodeDecode';
import {
  clearAllUserCaches,
  listTicketDisplayCache,
  subscribeTicketDisplayCacheUpdated,
} from '../../../features/tickets/ticketDisplayCache';
import { useEventConfig } from '../../../hooks/useEventConfig';

import type { UserData } from '../../../types/types';
import NormalSection from '../../../components/ui/NormalSection';
import {
  type TicketCardItem,
  type TicketListSortMode,
} from '../../../features/tickets/IssuedTicketCardList';
import TicketListContent from '../../../features/tickets/TicketListContent';
import type { CachedTicketDisplay } from '../../../types/types';

import subPageStyles from '../../../styles/sub-pages.module.css';
import sharedStyles from '../../../styles/shared.module.css';
import styles from './Dashboard.module.css';
import { IoMdAdd } from 'react-icons/io';
import PerformancesTable from '../../../features/performances/PerformancesTable';
import GymPerformancesTable from '../../../features/performances/GymPerformancesTable';
import { readCachedTicketCards, writeCachedTicketCards } from './offlineCache';
import Alert from '../../../components/ui/Alert';
import { formatDateText } from '../../../utils/formatDateText';
import LoadingSpinner from '../../../components/ui/LoadingSpinner';
import { useTicketStorage } from '../../../features/tickets/useTicketStorage';
import { formatTicketTypeLabel } from '../../../features/tickets/formatTicketTypeLabel';
import { useTitle } from '../../../hooks/useTitle';
import { withTimeout } from '../../../utils/withTimeout';
import Modal from '../../../components/ui/Modal';

const STUDENT_TICKETS_CACHE_PREFIX = 'ticket-display-cache:v1:';
const STUDENT_ACCOUNT_CONFIRMATION_STORAGE_PREFIX =
  'student-account-confirmed:v1:';
const SUPABASE_RESPONSE_TIMEOUT_MS = 8000;

const readAllLocalStorageTickets = (): Array<
  TicketCardItem & { relationshipId: number; affiliation: string }
> => {
  try {
    const allTickets: Array<
      TicketCardItem & { relationshipId: number; affiliation: string }
    > = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(STUDENT_TICKETS_CACHE_PREFIX)) {
        const raw = window.localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw).ticket as TicketCardItem & {
            relationshipId: number;
            affiliation: string;
          };
          allTickets.push(parsed);
        }
      }
    }
    return allTickets;
  } catch {
    return [];
  }
};

type DashboardProps = {
  userData: Exclude<UserData, null>;
};

type TicketSnapshot = {
  performances?: Array<{
    id: number;
    class_name: string;
    title?: string | null;
  }>;
  schedules?: Array<{ id: number; round_name: string }>;
  gymPerformances?: Array<{
    id: number;
    group_name: string;
    round_name: string;
    start_at: string | null;
    end_at: string | null;
  }>;
  ticketTypes?: Array<{ id: number; name: string; type?: string | null }>;
  relationships?: Array<{ id: number; name: string }>;
};

const ticketSnapshot = performancesSnapshot as TicketSnapshot;

const Dashboard = ({ userData }: DashboardProps) => {
  const { config } = useEventConfig();
  const { saveTicketToCache } = useTicketStorage();
  const [ticketCards, setTicketCards] = useState<
    (TicketCardItem & { relationshipId: number; affiliation: string })[]
  >([]);
  const [issuedTicketNumber, setIssuedTicketNumber] = useState(0);
  const [ticketLoading, setTicketLoading] = useState(true);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [ticketNotice, setTicketNotice] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [isTicketIssuingEnabled, setIsTicketIssuingEnabled] = useState(true);
  const [hasAnyActiveInviteTicketType, setHasAnyActiveInviteTicketType] =
    useState(true);
  const [myTicketSortMode, setMyTicketSortMode] = useState<TicketListSortMode>(
    () => {
      try {
        return (
          (localStorage.getItem(
            'ticketListSortMode.myTicket',
          ) as TicketListSortMode) || 'recent'
        );
      } catch {
        return 'recent';
      }
    },
  );
  const [guestTicketSortMode, setGuestTicketSortMode] =
    useState<TicketListSortMode>(() => {
      try {
        return (
          (localStorage.getItem(
            'ticketListSortMode.guestTicket',
          ) as TicketListSortMode) || 'recent'
        );
      } catch {
        return 'recent';
      }
    });
  const [ticketDisplayCacheVersion, setTicketDisplayCacheVersion] = useState(0);
  const [classInviteMode, setClassInviteMode] = useState<
    'open' | 'only-own' | 'off'
  >('open');
  const [gymInviteMode, setGymInviteMode] = useState<
    'open' | 'only-own' | 'off'
  >('open');
  const [ownClassName, setOwnClassName] = useState<string | null>(null);
  const [hasReachedIssueLimit, setHasReachedIssueLimit] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordChangeError, setPasswordChangeError] = useState<string | null>(
    null,
  );
  const [passwordChangeSuccess, setPasswordChangeSuccess] = useState<
    string | null
  >(null);
  const [isClearCacheModalOpen, setIsClearCacheModalOpen] = useState(false);
  const [isAccountConfirmationModalOpen, setIsAccountConfirmationModalOpen] =
    useState(false);
  const [isConfirmingAccount, setIsConfirmingAccount] = useState(false);
  const [accountConfirmationError, setAccountConfirmationError] = useState<
    string | null
  >(null);

  useTitle('ダッシュボード - 生徒用ページ');

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('ticketListSortMode.myTicket', myTicketSortMode);
    } catch {
      // Ignore errors
    }
  }, [myTicketSortMode]);

  useEffect(() => {
    try {
      localStorage.setItem(
        'ticketListSortMode.guestTicket',
        guestTicketSortMode,
      );
    } catch {
      // Ignore errors
    }
  }, [guestTicketSortMode]);

  useEffect(() => {
    const refresh = () =>
      setTicketDisplayCacheVersion((previous) => previous + 1);
    const unsubscribe = subscribeTicketDisplayCacheUpdated(() => {
      refresh();
    });
    window.addEventListener('storage', refresh);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const isIssueReceptionStopped =
    !isTicketIssuingEnabled || !hasAnyActiveInviteTicketType;

  useEffect(() => {
    const loadTickets = async () => {
      setTicketLoading(true);
      setTicketError(null);
      setTicketNotice(null);

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (sessionError || !user) {
        setTicketError('ログイン情報の取得に失敗しました。');
        setTicketLoading(false);
        return;
      }

      const fallbackToCachedTickets = () => {
        const cachedTickets = readCachedTicketCards(user.id);
        if (cachedTickets) {
          setTicketCards(cachedTickets);
          setTicketNotice(
            'チケット情報の取得に失敗したため、前回読み込んだ発券済みチケットを表示しています。',
          );
          setTicketError(null);
          setTicketLoading(false);
          setIsOnline(false);
          return true;
        }
        return false;
      };

      let ticketsData: unknown;
      let ticketsError: unknown;
      try {
        const result = await withTimeout(
          supabase.rpc('get_student_dashboard'),
          SUPABASE_RESPONSE_TIMEOUT_MS,
        );
        ticketsData = result.data;
        ticketsError = result.error;
      } catch {
        if (fallbackToCachedTickets()) {
          return;
        }
        setTicketError('チケット情報の取得がタイムアウトしました。');
        setTicketLoading(false);
        return;
      }

      if (ticketsError) {
        if (fallbackToCachedTickets()) {
          return;
        }
        setTicketError('チケット情報の取得に失敗しました。');
        setTicketLoading(false);
        return;
      }
      setIsOnline(true);

      const dashboard = (ticketsData ?? {}) as {
        profile?: {
          affiliation?: number | null;
          clubs?: string[] | null;
          account_confirmed?: boolean | null;
        };
        config?: {
          is_active?: boolean | null;
          show_length?: number | null;
          max_tickets_per_user?: number | null;
          max_tickets_per_gym_user?: number | null;
          gym_ticket_limits_by_club?: Record<string, unknown> | null;
        };
        controls?: {
          class_invite_mode?: 'open' | 'only-own' | 'off';
          rehearsal_invite_mode?: string | null;
          gym_invite_mode?: 'open' | 'only-own' | 'off';
          entry_only_mode?: string | null;
        };
        class_ticket_count?: number;
        gym_ticket_count?: number;
        tickets?: Array<{
          code: string;
          signature: string;
          relationship: number;
          created_at: string;
          ticket_name: string | null;
        }>;
        class_performances?: unknown[];
        gym_performances?: unknown[];
        schedules?: unknown[];
      };
      const controls = dashboard.controls;
      if (dashboard.profile?.account_confirmed === false) {
        setIsAccountConfirmationModalOpen(true);
      }
      if (typeof dashboard.config?.is_active === 'boolean') {
        setIsTicketIssuingEnabled(dashboard.config.is_active);
      }
      if (controls) {
        setClassInviteMode(controls.class_invite_mode ?? 'open');
        setGymInviteMode(controls.gym_invite_mode ?? 'open');
        setHasAnyActiveInviteTicketType(
          controls.class_invite_mode !== 'off' ||
            controls.rehearsal_invite_mode !== 'off' ||
            controls.gym_invite_mode !== 'off' ||
            controls.entry_only_mode !== 'off',
        );
      }
      const affiliation = Number(dashboard.profile?.affiliation ?? -1);
      const grade = Math.floor(affiliation / 10000);
      const classNo = Math.floor((affiliation % 10000) / 100);
      if (
        affiliation >= 10000 &&
        grade >= 1 && grade <= config.grade_number &&
        classNo >= 1 && classNo <= config.class_number
      ) {
        setOwnClassName(`${grade}-${classNo}`);
      }
      const maxClassTickets = Number(dashboard.config?.max_tickets_per_user ?? -1);
      const maxGymTickets = Number(dashboard.config?.max_tickets_per_gym_user ?? -1);
      const clubs = dashboard.profile?.clubs ?? [];
      const limitsByClub = dashboard.config?.gym_ticket_limits_by_club ?? {};
      const gymTicketLimit = clubs.length > 0
        ? clubs.reduce((total, club) => {
            const configuredLimit = Number(limitsByClub[club]);
            return total + (Number.isInteger(configuredLimit) && configuredLimit >= 0
              ? configuredLimit
              : maxGymTickets);
          }, 0)
        : maxGymTickets;
      if (maxClassTickets >= 0 && maxGymTickets >= 0) {
        setHasReachedIssueLimit(
          Number(dashboard.class_ticket_count ?? 0) >= maxClassTickets &&
            Number(dashboard.gym_ticket_count ?? 0) >= gymTicketLimit,
        );
      }

      // Load tickets from local storage (from all users)
      const localStorageTickets = readAllLocalStorageTickets();
      const myAffiliation = String(userData.affiliation);

      // Filter local storage tickets: only include those issued by other users
      const otherUsersLocalStorageTickets = localStorageTickets.filter(
        (ticket) =>
          ticket.affiliation !== myAffiliation && ticket.status === 'valid',
      );

      const tickets = (dashboard.tickets ?? []) as Array<{
        code: string;
        signature: string;
        relationship: number;
        created_at: string;
        ticket_name: string | null;
      }>;

      if (tickets.length === 0 && otherUsersLocalStorageTickets.length === 0) {
        setTicketCards([]);
        setTicketLoading(false);
        return;
      }

      const decodedTickets = await Promise.all(
        tickets.map(async (ticket) => {
          const decodedRaw = await decodeTicketCodeWithEnv(ticket.code);

          return {
            ticket,
            decoded: toTicketDecodedDisplaySeed(decodedRaw),
          };
        }),
      );

      const classPerformanceData = dashboard.class_performances ?? [];
      const gymPerformanceData = dashboard.gym_performances ?? [];
      const scheduleData = dashboard.schedules ?? [];
      const configData = dashboard.config ?? null;

      const classPerformanceMap = new Map(
        (
          (classPerformanceData ?? []) as Array<{
            id: number;
            class_name: string;
            title: string | null;
          }>
        ).map((performance) => [performance.id, performance]),
      );

      const gymPerformanceMap = new Map(
        (
          (gymPerformanceData ?? []) as Array<{
            id: number;
            group_name: string;
            round_name: string;
            start_at: string | null;
            end_at: string | null;
          }>
        ).map((performance) => [performance.id, performance]),
      );
      const snapshotGymPerformanceMap = new Map(
        (ticketSnapshot.gymPerformances ?? []).map((performance) => [
          performance.id,
          performance,
        ]),
      );

      const scheduleMap = new Map(
        (
          (ticketSnapshot.schedules ?? []) as Array<{
            id: number;
            round_name: string;
          }>
        ).map((schedule) => [schedule.id, schedule]),
      );

      const scheduleTimesMap = new Map(
        (
          (scheduleData ?? []) as Array<{
            id: number;
            start_at: string | null;
          }>
        ).map((schedule) => {
          const startAt = schedule.start_at
            ? new Date(schedule.start_at)
            : null;
          const showLengthMinutes = Number(configData?.show_length ?? 0);
          const endAt =
            startAt && Number.isFinite(showLengthMinutes)
              ? new Date(startAt.getTime() + showLengthMinutes * 60 * 1000)
              : null;

          return [
            schedule.id,
            {
              scheduleDate: startAt
                ? startAt.toLocaleDateString('ja-JP', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                  })
                : '-',
              scheduleTime: startAt
                ? startAt.toLocaleTimeString('ja-JP', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '',
              scheduleEndTime: endAt
                ? endAt.toLocaleTimeString('ja-JP', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '',
            },
          ];
        }),
      );

      const ticketTypeMap = new Map(
        (
          (ticketSnapshot.ticketTypes ?? []) as Array<{
            id: number;
            name: string;
            type?: string | null;
          }>
        ).map((ticketType) => [
          ticketType.id,
          formatTicketTypeLabel({
            type: ticketType.type,
            name: ticketType.name,
            fallback: `券種${ticketType.id}`,
          }),
        ]),
      );
      const relationshipMap = new Map(
        (
          (ticketSnapshot.relationships ?? []) as Array<{
            id: number;
            name: string;
          }>
        ).map((relationship) => [relationship.id, relationship.name]),
      );

      const snapshotPerformanceMap = new Map(
        (
          (ticketSnapshot.performances ?? []) as Array<{
            id: number;
            class_name: string;
            title?: string | null;
          }>
        ).map((performance) => [performance.id, performance]),
      );

      const cards = decodedTickets.map(({ ticket, decoded }) => {
        const relationshipId = decoded?.relationshipId ?? ticket.relationship;
        const isGymPerformance =
          (decoded?.performanceId ?? 0) > 0 && (decoded?.scheduleId ?? 0) === 0;
        const classPerformance = decoded
          ? (classPerformanceMap.get(decoded.performanceId) ??
            snapshotPerformanceMap.get(decoded.performanceId))
          : undefined;
        const gymPerformance = decoded
          ? gymPerformanceMap.get(decoded.performanceId)
          : undefined;
        const schedule =
          !isGymPerformance && decoded
            ? scheduleMap.get(decoded.scheduleId)
            : undefined;
        const isAdmissionOnly =
          decoded?.performanceId === 0 && decoded?.scheduleId === 0;

        return {
          code: ticket.code,
          signature: ticket.signature,
          serial: decoded?.serial,
          performanceName: isAdmissionOnly
            ? '入場専用券'
            : isGymPerformance
              ? (gymPerformance?.group_name ?? '-')
              : (classPerformance?.class_name ?? '-'),
          performanceTitle: isGymPerformance
            ? null
            : (classPerformance?.title ?? null),
          scheduleName: isAdmissionOnly
            ? ''
            : isGymPerformance
              ? (gymPerformance?.round_name ?? '-')
              : (schedule?.round_name ?? '-'),
          ticketTypeLabel: decoded
            ? (ticketTypeMap.get(decoded.ticketTypeId) ??
              `券種${decoded.ticketTypeId}`)
            : '-',
          relationshipName: decoded
            ? (relationshipMap.get(decoded.relationshipId) ??
              `間柄${decoded.relationshipId}`)
            : '-',
          ticketName: ticket.ticket_name,
          status: 'valid' as const,
          relationshipId,
          affiliation: decoded?.affiliation ?? '',
        };
      });

      setIssuedTicketNumber(cards.length);

      // Merge database tickets with local storage tickets from other users
      const allCards = [...cards, ...otherUsersLocalStorageTickets];

      setTicketCards(allCards);
      writeCachedTicketCards(user.id, cards);

      // Cache individual tickets to ticketDisplayCache
      void Promise.all(
        decodedTickets.map(({ ticket, decoded }) => {
          const isGymPerformance =
            (decoded?.performanceId ?? 0) > 0 &&
            (decoded?.scheduleId ?? 0) === 0;
          const classPerformance = decoded
            ? (classPerformanceMap.get(decoded.performanceId) ??
              snapshotPerformanceMap.get(decoded.performanceId))
            : undefined;
          const gymPerformance = decoded
            ? (snapshotGymPerformanceMap.get(decoded.performanceId) ??
              gymPerformanceMap.get(decoded.performanceId))
            : undefined;
          const schedule =
            !isGymPerformance && decoded
              ? scheduleMap.get(decoded.scheduleId)
              : undefined;
          const scheduleTimes =
            !isGymPerformance && decoded
              ? scheduleTimesMap.get(decoded.scheduleId)
              : undefined;
          const isAdmissionOnly =
            decoded?.performanceId === 0 && decoded?.scheduleId === 0;

          let scheduleDate = scheduleTimes?.scheduleDate ?? '-';
          let scheduleTime = scheduleTimes?.scheduleTime ?? '';
          let scheduleEndTime = scheduleTimes?.scheduleEndTime ?? '';

          if (isAdmissionOnly) {
            const eventDates = (config.date ?? []).filter(
              (date) => typeof date === 'string' && date.length > 0,
            );
            scheduleDate = formatDateText(eventDates) || '-';
            scheduleTime = '';
            scheduleEndTime = '';
          } else if (isGymPerformance) {
            const startAt = gymPerformance?.start_at
              ? new Date(gymPerformance.start_at)
              : null;
            const endAt = gymPerformance?.end_at
              ? new Date(gymPerformance.end_at)
              : null;

            scheduleDate = startAt
              ? startAt.toLocaleDateString('ja-JP', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                })
              : '-';
            scheduleTime = startAt
              ? startAt.toLocaleTimeString('ja-JP', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '';
            scheduleEndTime = endAt
              ? endAt.toLocaleTimeString('ja-JP', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '';
          }

          return saveTicketToCache(
            ticket.code,
            ticket.signature,
            {
              performanceName: isAdmissionOnly
                ? '入場専用券'
                : isGymPerformance
                  ? (gymPerformance?.group_name ?? '-')
                  : (classPerformance?.class_name ?? '-'),
              performanceTitle: isGymPerformance
                ? null
                : (classPerformance?.title ?? null),
              scheduleName: isAdmissionOnly
                ? ''
                : isGymPerformance
                  ? (gymPerformance?.round_name ?? '-')
                  : (schedule?.round_name ?? '-'),
              scheduleDate,
              scheduleTime,
              scheduleEndTime,
              ticketTypeLabel: decoded
                ? (ticketTypeMap.get(decoded.ticketTypeId) ??
                  `券種${decoded.ticketTypeId}`)
                : '-',
              relationshipName: decoded
                ? (relationshipMap.get(decoded.relationshipId) ??
                  `間柄${decoded.relationshipId}`)
                : '-',
              relationshipId: decoded?.relationshipId ?? ticket.relationship,
              ticketName: ticket.ticket_name,
            },
            'valid',
          );
        }),
      );

      setTicketLoading(false);
    };

    void loadTickets();
  }, []);

  const ticketCardsWithLastOpenedAt = useMemo(() => {
    const lastOpenedAtByCode = new Map(
      listTicketDisplayCache<CachedTicketDisplay>().map((ticket) => [
        ticket.code,
        typeof ticket.lastOpenedAt === 'number' ? ticket.lastOpenedAt : 0,
      ]),
    );

    return ticketCards.map((ticket) => ({
      ...ticket,
      lastOpenedAt: lastOpenedAtByCode.get(ticket.code) ?? 0,
    }));
  }, [ticketCards, ticketDisplayCacheVersion]);

  const myAffiliation = String(userData.affiliation);

  const ownUseTickets = useMemo(() => {
    return ticketCardsWithLastOpenedAt.filter(
      (ticket) =>
        (ticket.relationshipId === 1 && ticket.affiliation === myAffiliation) ||
        (ticket.relationshipId === 3 && ticket.affiliation !== myAffiliation),
    );
  }, [ticketCardsWithLastOpenedAt, myAffiliation]);

  const guestTickets = useMemo(
    () =>
      ticketCardsWithLastOpenedAt.filter((ticket) => {
        const affiliation = ticket.affiliation;
        // Include tickets from current user with relationshipId !== 1 (original guest tickets)
        if (affiliation === myAffiliation && ticket.relationshipId !== 1) {
          return true;
        }
        // Include tickets from other users with relationshipId in {2,4,5}
        if (
          affiliation !== myAffiliation &&
          (ticket.relationshipId === 2 ||
            ticket.relationshipId === 4 ||
            ticket.relationshipId === 5)
        ) {
          return true;
        }
        return false;
      }),
    [ticketCardsWithLastOpenedAt, myAffiliation],
  );

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleClearAllCaches = () => {
    clearAllUserCaches();
    setIsClearCacheModalOpen(false);
  };

  const handleAccountConfirmation = async () => {
    setAccountConfirmationError(null);
    setIsConfirmingAccount(true);

    try {
      const { error } = await supabase.rpc('confirm_student_account');
      if (error) {
        throw error;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        try {
          localStorage.setItem(
            `${STUDENT_ACCOUNT_CONFIRMATION_STORAGE_PREFIX}${user.id}`,
            'true',
          );
        } catch {
          // The database remains the source of truth when storage is unavailable.
        }
      }
      setIsAccountConfirmationModalOpen(false);
    } catch {
      setAccountConfirmationError(
        '確認内容を保存できませんでした。通信状況を確認して、もう一度お試しください。',
      );
    } finally {
      setIsConfirmingAccount(false);
    }
  };

  const handlePasswordChange = async (event: Event) => {
    event.preventDefault();
    setPasswordChangeError(null);
    setPasswordChangeSuccess(null);

    if (!currentPassword) {
      setPasswordChangeError('現在のパスワードを入力してください。');
      return;
    }

    if (newPassword.length < 8) {
      setPasswordChangeError('新しいパスワードは8文字以上で入力してください。');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setPasswordChangeError(
        '新しいパスワードと確認用パスワードが一致しません。',
      );
      return;
    }

    setIsChangingPassword(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user?.email) {
        throw new Error(
          'ログイン情報を確認できません。再ログインしてください。',
        );
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });

      if (signInError) {
        setPasswordChangeError('現在のパスワードが正しくありません。');
        return;
      }

      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        throw error;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setPasswordChangeSuccess('パスワードを変更しました。');
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : '時間をおいて再度お試しください。';
      setPasswordChangeError(`パスワード変更に失敗しました。${message}`);
    } finally {
      setIsChangingPassword(false);
    }
  };

  const restrictedClassName = useMemo(() => {
    const result =
      classInviteMode === 'only-own' ? (ownClassName ?? null) : null;
    return result;
  }, [classInviteMode, ownClassName]);

  const restrictedGroupNames = useMemo(() => {
    const clubs = (userData as { clubs?: string[] | null }).clubs;
    return gymInviteMode === 'only-own' ? (clubs ?? []) : null;
  }, [gymInviteMode, userData]);

  return (
    <>
      <h1 className={subPageStyles.pageTitle}>ダッシュボード</h1>
      <section>
        <h2 className={sharedStyles.normalH2}>
          {Math.floor(userData.affiliation / 10000)}-
          {Math.floor((userData.affiliation % 10000) / 100)}
          {' ' + (userData.affiliation % 100) + '番 '}
        </h2>
        <a
          href='/students/issue'
          className={`${styles.buttonLink} ${!isOnline || isIssueReceptionStopped ? styles.buttonLinkDisabled : ''}`}
          aria-disabled={!isOnline || isIssueReceptionStopped}
          tabIndex={!isOnline || isIssueReceptionStopped ? -1 : 0}
          onClick={(event) => {
            if (!isOnline || isIssueReceptionStopped) {
              event.preventDefault();
            }
          }}
        >
          <IoMdAdd />
          新規チケット発行
        </a>
        {!isOnline && (
          <p className={styles.issueOfflineNote}>
            オフライン中は新規チケットを発行できません。
          </p>
        )}
        {isOnline &&
          isTicketIssuingEnabled &&
          hasAnyActiveInviteTicketType &&
          hasReachedIssueLimit && (
            <p className={styles.issueOfflineNote}>
              最大発行可能枚数に達しているため、入場専用券のみ発券できます。
            </p>
          )}
        {isOnline &&
          (!isTicketIssuingEnabled || !hasAnyActiveInviteTicketType) && (
            <p className={styles.issueOfflineNote}>
              現在チケット発券は受付停止中です。
            </p>
          )}
      </section>
      {ticketNotice && (
        <Alert type='info'>
          <p>{ticketNotice}</p>
        </Alert>
      )}
      <NormalSection>
        <h2>発券状況</h2>
        {ticketLoading ? (
          <LoadingSpinner />
        ) : ticketError ? (
          <p>{ticketError}</p>
        ) : ticketCards.length > 0 ? (
          <div className={styles.ticketSummary}>
            <div className={styles.ticketSummaryItem}>
              <p className={styles.ticketSummaryNumber}>{issuedTicketNumber}</p>
              <p className={styles.ticketSummaryLabel}>合計発券枚数</p>
            </div>
            <div className={styles.ticketSummaryItem}>
              <p className={styles.ticketSummaryNumber}>
                {ownUseTickets.length}
              </p>
              <p className={styles.ticketSummaryLabel}>自分用</p>
            </div>
            <div className={styles.ticketSummaryItem}>
              <p className={styles.ticketSummaryNumber}>
                {guestTickets.length}
              </p>
              <p className={styles.ticketSummaryLabel}>招待者用</p>
            </div>
          </div>
        ) : (
          <p>まだチケットは発券されていません。</p>
        )}
      </NormalSection>
      <NormalSection>
        <h2>自分が使うチケット</h2>
        <TicketListContent
          loading={ticketLoading}
          error={ticketError}
          tickets={ownUseTickets}
          showSortControl
          sortMode={myTicketSortMode}
          onSortModeChange={setMyTicketSortMode}
          emptyMessage='自分が使うチケットはまだありません。'
        />
      </NormalSection>
      <NormalSection>
        <h2>招待者用のチケット</h2>
        <TicketListContent
          loading={ticketLoading}
          error={ticketError}
          tickets={guestTickets}
          showSortControl
          sortMode={guestTicketSortMode}
          onSortModeChange={setGuestTicketSortMode}
          emptyMessage='招待者用のチケットはまだありません。'
        />
      </NormalSection>
      <NormalSection>
        <h2>公演空き状況</h2>
        <a href='/performances' className={styles.smallButtonLink}>
          公演の詳細はこちら
        </a>
        <a href='/timetable' className={styles.smallButtonLink}>
          タイムテーブルはこちら
        </a>
        <h3>クラス公演</h3>
        <PerformancesTable
          enableIssueJump={true}
          restrictedClassName={restrictedClassName}
          filterAccepting={true}
        />
        <h3>体育館公演</h3>
        <GymPerformancesTable
          enableIssueJump={true}
          restrictedGroupNames={restrictedGroupNames}
          filterAccepting={true}
        />
      </NormalSection>
      <NormalSection>
        <h2>パスワード変更</h2>
        <form className={styles.passwordForm} onSubmit={handlePasswordChange}>
          <input
            type='text'
            name='username'
            value={userData.affiliation}
            autocomplete='username'
            style='display: none;'
            aria-hidden='true'
          />
          <label
            className={styles.passwordLabel}
            htmlFor='student-current-password'
          >
            現在のパスワード
          </label>
          <input
            id='student-current-password'
            type='password'
            className={styles.passwordInput}
            value={currentPassword}
            onInput={(event) =>
              setCurrentPassword((event.target as HTMLInputElement).value)
            }
            autoComplete='current-password'
            required
          />
          <label
            className={styles.passwordLabel}
            htmlFor='student-new-password'
          >
            新しいパスワード
          </label>
          <input
            id='student-new-password'
            type='password'
            className={styles.passwordInput}
            value={newPassword}
            onInput={(event) =>
              setNewPassword((event.target as HTMLInputElement).value)
            }
            autoComplete='new-password'
            minLength={8}
            required
          />
          <label
            className={styles.passwordLabel}
            htmlFor='student-new-password-confirm'
          >
            新しいパスワード（確認）
          </label>
          <input
            id='student-new-password-confirm'
            type='password'
            className={styles.passwordInput}
            value={confirmNewPassword}
            onInput={(event) =>
              setConfirmNewPassword((event.target as HTMLInputElement).value)
            }
            autoComplete='new-password'
            minLength={8}
            required
          />
          {passwordChangeError && (
            <p className={styles.passwordError} role='alert'>
              {passwordChangeError}
            </p>
          )}
          {passwordChangeSuccess && (
            <p className={styles.passwordSuccess} role='status'>
              {passwordChangeSuccess}
            </p>
          )}
          <button
            type='submit'
            className={styles.passwordButton}
            disabled={isChangingPassword}
          >
            {isChangingPassword ? '変更中...' : 'パスワードを変更'}
          </button>
        </form>
      </NormalSection>
      <NormalSection>
        <h2>設定</h2>
        <button
          type='button'
          className={subPageStyles.removeButton}
          onClick={() => setIsClearCacheModalOpen(true)}
        >
          すべてのキャッシュを削除
        </button>
      </NormalSection>
      <section>
        <button onClick={handleLogout} className={styles.logoutBtn}>
          ログアウト
        </button>
      </section>
      {isClearCacheModalOpen ? (
        <Modal
          setIsOpen={setIsClearCacheModalOpen}
          handleAction={handleClearAllCaches}
          headingText='すべてのキャッシュを削除しますか？'
          buttonText='削除する'
        >
          <p>チケット表示履歴が消去されます。</p>
          <p>チケットはキャンセルされません。</p>
        </Modal>
      ) : null}
      {isAccountConfirmationModalOpen ? (
        <Modal
          setIsOpen={setIsAccountConfirmationModalOpen}
          handleAction={handleAccountConfirmation}
          headingText='アカウントを間違えていませんか？'
          buttonText={isConfirmingAccount ? '保存中...' : '確認しました'}
          showCancelButton={false}
          closeOnOverlayClick={false}
        >
          <p>このアカウントで登録されている情報です。</p>
          <p className={styles.accountConfirmationAffiliation}>
            {Math.floor(userData.affiliation / 10000)}年
            {Math.floor((userData.affiliation % 10000) / 100)}組
            {userData.affiliation % 100}番
          </p>
          <p>
            間違っている場合は、
            <a
              href='https://docs.google.com/forms/d/e/1FAIpQLSfGsEXv2e1IoDbF2RjhrCyK5myHU0Dq-YJ4_3dHMhNeLAvjUg/viewform?usp=dialog'
              target='_blank'
              rel='noopener noreferrer'
            >
              お問い合わせフォーム
            </a>
            よりご連絡ください。
          </p>
          {accountConfirmationError ? (
            <p className={styles.passwordError} role='alert'>
              {accountConfirmationError}
            </p>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
};

export default Dashboard;
