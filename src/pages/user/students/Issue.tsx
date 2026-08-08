import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import IssueStepDetails from '../../../features/issue/IssueStepDetails';
import IssueStepPerformance from '../../../features/issue/IssueStepPerformance';
import IssueStepTicketType from '../../../features/issue/IssueStepTicketType';
import { ISSUE_RESULT_STORAGE_KEY } from '../../../features/issue/issueResultStorage';

import { supabase } from '../../../lib/supabase';
import performancesSnapshot from '../../../generated/performances-static.json';
import type {
  RelationshipRow,
  SelectedPerformance,
  Step,
  TicketTypeOption,
} from '../../../types/Issue.types';
import styles from './Issue.module.css';
import BackButton from '../../../components/ui/BackButton';
import { formatDateText } from '../../../utils/formatDateText';
import { useEventConfig } from '../../../hooks/useEventConfig';
import { formatTicketTypeLabel } from '../../../features/tickets/formatTicketTypeLabel';
import Alert from '../../../components/ui/Alert';
import LoadingSpinner from '../../../components/ui/LoadingSpinner';
import { useTitle } from '../../../hooks/useTitle';
import { getStudentIssueBootstrap } from '../../../features/tickets/studentIssueBootstrap';

const MAX_ISSUE_COUNT = 5;
const PANEL_ANIMATION_MS = 360;
const ADMISSION_ONLY_TICKET_NAME = '入場専用券';
const GYM_TICKET_KEYWORD = '体育館';
const CLASS_INVITE_TICKET_ID = 1;
const GYM_INVITE_TICKET_ID = 3;

const gymPerformanceSnapshot = performancesSnapshot as {
  gymPerformances?: Array<{
    id: number;
    start_at?: string | null;
    end_at?: string | null;
  }>;
};

type ClassTicketCounterRow = {
  issued_general: number | null;
  issued_junior: number | null;
  issued_other: number | null;
};

type GymTicketCounterRow = {
  issued_general: number | null;
  issued_junior: number | null;
  issued_other: number | null;
};

const calculateClassGeneralRemaining = ({
  totalCapacity,
  juniorCapacity,
  issuedGeneral,
  issuedJunior,
  issuedOther,
  isJuniorReleased,
}: {
  totalCapacity: number;
  juniorCapacity: number;
  issuedGeneral: number;
  issuedJunior: number;
  issuedOther: number;
  isJuniorReleased: boolean;
}): number => {
  if (isJuniorReleased) {
    return Math.max(
      totalCapacity - issuedGeneral - issuedJunior - issuedOther,
      0,
    );
  }

  return Math.max(
    totalCapacity - juniorCapacity - issuedGeneral - issuedOther,
    0,
  );
};

const readFunctionErrorMessage = async (error: unknown): Promise<string> => {
  const fallback =
    error instanceof Error ? error.message : '不明なエラーが発生しました。';

  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const context = (error as { context?: unknown }).context;

  if (!context) {
    return fallback;
  }

  try {
    const response =
      context instanceof Response
        ? context.clone()
        : (context as {
            json?: () => Promise<unknown>;
            text?: () => Promise<string>;
          });

    if (typeof response.json === 'function') {
      const payload = await response.json();

      if (payload && typeof payload === 'object') {
        const maybeMessage =
          (payload as { error?: unknown; message?: unknown; msg?: unknown })
            .error ??
          (payload as { message?: unknown }).message ??
          (payload as { msg?: unknown }).msg;

        if (typeof maybeMessage === 'string' && maybeMessage.length > 0) {
          return maybeMessage;
        }
      }
    }

    if (typeof response.text === 'function') {
      const text = await response.text();

      if (text.length > 0) {
        return text;
      }
    }
  } catch {
    return fallback;
  }

  return fallback;
};

const Issue = () => {
  const [step, setStep] = useState<Step>(1);
  const [selectedTicketTypeId, setSelectedTicketTypeId] = useState<number>(1);
  const [selectedPerformance, setSelectedPerformance] =
    useState<SelectedPerformance>(null);
  const [ticketTypes, setTicketTypes] = useState<TicketTypeOption[]>([]);
  const [issueControls, setIssueControls] = useState<{
    class_invite_mode: 'open' | 'only-own' | 'outside-own-self-only' | 'off';
    rehearsal_invite_mode: 'open' | 'only-own' | 'off';
    gym_invite_mode: 'open' | 'only-own' | 'outside-own-self-only' | 'off';
    entry_only_mode: 'open' | 'only-own' | 'off';
  } | null>(null);
  const [relationships, setRelationships] = useState<RelationshipRow[]>([]);
  const [relationshipLoading, setRelationshipLoading] = useState(true);
  const [relationshipError, setRelationshipError] = useState<string | null>(
    null,
  );
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<
    number | null
  >(null);
  const [issueCount, setIssueCount] = useState(1);
  const [remainingIssueCapacity, setRemainingIssueCapacity] = useState<{
    class: number;
    gym: number;
  } | null>(null);
  const [classRemainingPerformanceId, setClassRemainingPerformanceId] =
    useState<number | null>(null);
  const [classRemainingByPerformanceId, setClassRemainingByPerformanceId] =
    useState<Map<number, number>>(new Map());
  const [classPerformanceNames, setClassPerformanceNames] = useState<
    Map<number, string>
  >(new Map());
  const [gymRemainingByPerformanceId, setGymRemainingByPerformanceId] =
    useState<Map<number, number>>(new Map());
  const [gymPerformanceNames, setGymPerformanceNames] = useState<
    Map<number, string>
  >(new Map());
  const [isIssuing, setIsIssuing] = useState(false);
  const [
    hasOtherPerformanceTotalLimitError,
    setHasOtherPerformanceTotalLimitError,
  ] = useState(false);
  const [otherPerformanceTotalRemaining, setOtherPerformanceTotalRemaining] =
    useState<number | null>(null);
  const [isTicketIssuingEnabled, setIsTicketIssuingEnabled] = useState(true);
  const [classInviteMode, setClassInviteMode] = useState<
    'open' | 'only-own' | 'outside-own-self-only' | 'off'
  >('open');
  const [ownClassName, setOwnClassName] = useState<string | null>(null);
  const [ownClubs, setOwnClubs] = useState<string[] | null>(null);
  const [leavingStep, setLeavingStep] = useState<Step | null>(null);
  const [isForward, setIsForward] = useState(true);
  const [isInitializing, setIsInitializing] = useState(true); // 初期化フラグを追加
  const animationTimerRef = useRef<number | null>(null);
  const prevSelectedPerformanceRef = useRef<SelectedPerformance>(null);
  const [selectionFromQueryHasRun, setSelectionFromQueryHasRun] =
    useState(false);

  const { route } = useLocation();
  const { config } = useEventConfig();

  useTitle('チケット発券 - 生徒用ページ');

  useEffect(() => {
    const loadPerformanceRemaining = async () => {
      const { data, error } = await supabase.rpc(
        'get_student_performance_ticket_remaining',
      );
      if (error) {
        return;
      }
      const result = data as {
        class?: Record<string, number>;
        gym?: Record<string, number>;
        class_names?: Record<string, string>;
        gym_names?: Record<string, string>;
        other_total_remaining?: number;
      } | null;
      if (typeof result?.other_total_remaining === 'number') {
        setOtherPerformanceTotalRemaining(result.other_total_remaining);
      }
      setClassPerformanceNames(
        new Map(
          Object.entries(result?.class_names ?? {}).map(([id, name]) => [
            Number(id),
            name,
          ]),
        ),
      );
      setGymPerformanceNames(
        new Map(
          Object.entries(result?.gym_names ?? {}).map(([id, name]) => [
            Number(id),
            name,
          ]),
        ),
      );
      setClassRemainingByPerformanceId(
        new Map(
          Object.entries(result?.class ?? {}).map(([id, remaining]) => [
            Number(id),
            Number(remaining),
          ]),
        ),
      );
      setGymRemainingByPerformanceId(
        new Map(
          Object.entries(result?.gym ?? {}).map(([id, remaining]) => [
            Number(id),
            Number(remaining),
          ]),
        ),
      );
    };
    void loadPerformanceRemaining();
  }, []);

  useEffect(() => {
    const loadIssuingState = async () => {
      const { data } = await getStudentIssueBootstrap();
      const configData = (data as { config?: { is_active?: boolean | null } })
        ?.config;

      if (typeof configData?.is_active === 'boolean') {
        setIsTicketIssuingEnabled(configData.is_active);
      }
    };

    void loadIssuingState();
  }, []);

  useEffect(() => {
    const loadRemainingIssueCapacity = async () => {
      const { data } = await getStudentIssueBootstrap();
      const bootstrap = data as {
        config?: {
          max_tickets_per_other_club_user?: number | null;
          gym_ticket_limits_by_club?: Record<string, unknown> | null;
        };
        profile?: { clubs?: string[] | null };
        gym_ticket_count?: number;
      } | null;
      if (!bootstrap) {
        return;
      }

      const maxTicketsPerOtherClubUser = Number(
        bootstrap.config?.max_tickets_per_other_club_user ?? -1,
      );
      const clubs = Array.isArray(bootstrap.profile?.clubs)
        ? bootstrap.profile.clubs
        : [];
      const limitsByClub = bootstrap.config?.gym_ticket_limits_by_club ?? {};
      const gymTicketLimit =
        clubs.length > 0
          ? clubs.reduce((total, club) => {
              const configuredLimit = Number(limitsByClub[club]);
              return (
                total +
                (Number.isInteger(configuredLimit) && configuredLimit >= 0
                  ? configuredLimit
                  : maxTicketsPerOtherClubUser)
              );
            }, 0)
          : maxTicketsPerOtherClubUser;
      if (
        !Number.isInteger(maxTicketsPerOtherClubUser) ||
        maxTicketsPerOtherClubUser < 0
      ) {
        return;
      }

      setRemainingIssueCapacity({
        class: 100,
        gym: Math.max(
          0,
          gymTicketLimit - Number(bootstrap.gym_ticket_count ?? 0),
        ),
      });
    };

    void loadRemainingIssueCapacity();
  }, []);

  useEffect(() => {
    if (!selectedPerformance || selectedPerformance.performanceId <= 0) {
      return;
    }
    const remaining =
      selectedPerformance.scheduleId === 0
        ? gymRemainingByPerformanceId.get(selectedPerformance.performanceId)
        : classRemainingByPerformanceId.get(selectedPerformance.performanceId);
    if (remaining === undefined) {
      return;
    }
    setRemainingIssueCapacity((current) =>
      current
        ? {
            ...current,
            [selectedPerformance.scheduleId === 0 ? 'gym' : 'class']: remaining,
          }
        : current,
    );
    if (selectedPerformance.scheduleId > 0) {
      setClassRemainingPerformanceId(selectedPerformance.performanceId);
    }
  }, [
    selectedPerformance,
    classRemainingByPerformanceId,
    gymRemainingByPerformanceId,
  ]);

  useEffect(() => {
    const loadOwnProfile = async () => {
      const { data: bootstrapData } = await getStudentIssueBootstrap();
      const data = (
        bootstrapData as {
          profile?: { affiliation?: number | null; clubs?: string[] | null };
        } | null
      )?.profile;
      if (!data) {
        return;
      }

      setOwnClubs((data as { clubs?: string[] | null })?.clubs ?? []);

      const affiliation = Number(
        (data as { affiliation?: number | null } | null)?.affiliation ?? -1,
      );
      if (!Number.isInteger(affiliation) || affiliation < 10000) {
        return;
      }

      const grade = Math.floor(affiliation / 10000);
      const classNo = Math.floor((affiliation % 10000) / 100);
      if (
        grade >= 1 &&
        grade <= config.grade_number &&
        classNo >= 1 &&
        classNo <= config.class_number
      ) {
        setOwnClassName(`${grade}-${classNo}`);
      }
    };

    void loadOwnProfile();
  }, []);

  useEffect(() => {
    const loadIssueControls = async () => {
      try {
        const { data: bootstrapData } = await getStudentIssueBootstrap();
        const data = (
          bootstrapData as {
            controls?: {
              class_invite_mode:
                'open' | 'only-own' | 'outside-own-self-only' | 'off';
              rehearsal_invite_mode: 'open' | 'only-own' | 'off';
              gym_invite_mode:
                'open' | 'only-own' | 'outside-own-self-only' | 'off';
              entry_only_mode: 'open' | 'only-own' | 'off';
            } | null;
          } | null
        )?.controls;

        if (data) {
          setIssueControls(data);
          setClassInviteMode(data.class_invite_mode);
        }
      } catch (err) {
        // 特にエラーは表示しない
      }
    };

    void loadIssueControls();
  }, []);

  useEffect(() => {
    const loadTicketTypes = async () => {
      const { data: bootstrapData, error } = await getStudentIssueBootstrap();
      const data = (
        bootstrapData as { ticket_types?: TicketTypeOption[] } | null
      )?.ticket_types;
      if (error) {
        alert('チケット種別の読み込みに失敗しました。');
        return;
      }

      const nextTypes = (data ?? []) as TicketTypeOption[];
      setTicketTypes(nextTypes);
    };

    void loadTicketTypes();
  }, []);

  // ticket_issue_controls に基づいて有効な券種を計算
  const activeTicketTypes = useMemo(() => {
    if (!issueControls) {
      return [];
    }
    // クラス上限は対象クラスごとなので、券種全体は無効化しない。
    const hasReachedClassCapacity = false;
    return ticketTypes.map((t) => {
      let isActive = false;
      if (t.id === 1) {
        isActive =
          issueControls.class_invite_mode !== 'off' && !hasReachedClassCapacity;
      } else if (t.id === 2) {
        isActive =
          issueControls.rehearsal_invite_mode !== 'off' &&
          !hasReachedClassCapacity;
      } else if (t.id === 3) {
        isActive =
          issueControls.gym_invite_mode !== 'off' &&
          (issueControls.gym_invite_mode !== 'only-own' ||
            (ownClubs !== null && ownClubs.length > 0));
      } else if (t.id === 4) {
        isActive = issueControls.entry_only_mode !== 'off';
      }
      return { ...t, is_active: isActive };
    });
  }, [ticketTypes, issueControls, ownClubs, remainingIssueCapacity]);

  useEffect(() => {
    // URLからの初期化中や、既にSTEP 1以外にいる（URLで選択済みなど）場合は
    // 自動的に券種を切り替えないようにする
    if (isInitializing || step !== 1) {
      return;
    }

    const firstActive = activeTicketTypes.find((t) => t.is_active);
    if (firstActive) {
      setSelectedTicketTypeId(firstActive.id);
    }
  }, [activeTicketTypes, isInitializing, step]);

  useEffect(() => {
    const loadRelationships = async () => {
      setRelationshipLoading(true);

      const { data: bootstrapData, error } = await getStudentIssueBootstrap();
      const data = (
        bootstrapData as { relationships?: RelationshipRow[] } | null
      )?.relationships;

      if (error) {
        setRelationshipError('間柄の読み込みに失敗しました。');
        setRelationshipLoading(false);
        return;
      }

      setRelationships((data ?? []) as RelationshipRow[]);
      setRelationshipLoading(false);
    };

    void loadRelationships();
  }, []);

  useEffect(
    () => () => {
      if (animationTimerRef.current !== null) {
        window.clearTimeout(animationTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    // 制御情報、発行上限、所属部活などのロードが完了してから実行する
    // これにより、上限に達している場合に不正な自動選択が行われるのを防ぐ
    if (
      issueControls === null ||
      remainingIssueCapacity === null ||
      ownClubs === null ||
      selectionFromQueryHasRun
    ) {
      return;
    }

    const loadSelectionFromQuery = async () => {
      setSelectionFromQueryHasRun(true);
      setIsInitializing(true); // 読み込み開始
      const params = new URLSearchParams(window.location.search);
      const venue = params.get('venue');
      const performanceId = Number(params.get('performanceId'));
      const scheduleId = Number(params.get('scheduleId'));

      const pickTicketTypeIdForVenue = (
        targetVenue: 'class' | 'gym',
      ): number | null => {
        const options = ticketTypes as Array<{
          id: number;
          name: string;
        }>;

        // 利用可能かどうか（isActive）に関わらず、会場（Venue）に合致する券種を検索する
        const picked = options.find((ticketType) => {
          const isAdmissionOnly =
            ticketType.name === ADMISSION_ONLY_TICKET_NAME;
          const isGym = ticketType.name.includes(GYM_TICKET_KEYWORD);

          if (targetVenue === 'gym') {
            return isGym;
          }

          return !isAdmissionOnly && !isGym;
        });

        return picked?.id ?? null;
      };

      if (venue === 'gym') {
        if (!Number.isInteger(performanceId) || performanceId <= 0) {
          return;
        }

        const [
          { data: performanceData, error: performanceError },
          { data: counterData, error: counterError },
          { data: configData, error: configError },
        ] = await Promise.all([
          supabase
            .from('gym_performances')
            .select('id, group_name, round_name, capacity, junior_capacity')
            .eq('id', performanceId)
            .maybeSingle(),
          supabase
            .from('gym_ticket_counters')
            .select('issued_general, issued_junior, issued_other')
            .eq('performance_id', performanceId)
            .maybeSingle(),
          supabase
            .from('configs')
            .select('junior_release_open')
            .order('id', { ascending: true })
            .limit(1)
            .maybeSingle(),
        ]);

        if (
          performanceError ||
          counterError ||
          configError ||
          !performanceData
        ) {
          return;
        }

        const counter = counterData as GymTicketCounterRow | null;
        const capacity = Number(performanceData.capacity ?? 0);
        const juniorCapacity = Number(performanceData.junior_capacity ?? 0);
        const issuedGeneral = Number(counter?.issued_general ?? 0);
        const issuedJunior = Number(counter?.issued_junior ?? 0);
        const issuedOther = Number(counter?.issued_other ?? 0);
        const remaining = Math.max(
          configData?.junior_release_open
            ? capacity - issuedGeneral - issuedJunior - issuedOther
            : capacity - juniorCapacity - issuedGeneral - issuedOther,
          0,
        );

        if (remaining <= 0) {
          return;
        }

        const gymTicketTypeId = pickTicketTypeIdForVenue('gym');
        if (gymTicketTypeId !== null) {
          setSelectedTicketTypeId(gymTicketTypeId);
        }

        setSelectedPerformance({
          performanceId: performanceData.id,
          performanceName: performanceData.group_name,
          scheduleId: 0,
          scheduleName: performanceData.round_name,
          remaining,
        });
        setStep(3);
        setIsInitializing(false);
        return;
      } else if (
        Number.isInteger(performanceId) &&
        Number.isInteger(scheduleId) &&
        performanceId > 0 &&
        scheduleId > 0
      ) {
        const [
          { data: performanceData, error: performanceError },
          { data: scheduleData, error: scheduleError },
          { data: counterData, error: counterError },
          { data: configData, error: configError },
        ] = await Promise.all([
          supabase
            .from('class_performances')
            .select('id, class_name, total_capacity, junior_capacity')
            .eq('id', performanceId)
            .maybeSingle(),
          supabase
            .from('performances_schedule')
            .select('id, round_name')
            .eq('id', scheduleId)
            .maybeSingle(),
          supabase
            .from('class_ticket_counters')
            .select('issued_general, issued_junior, issued_other')
            .eq('class_id', performanceId)
            .eq('round_id', scheduleId)
            .maybeSingle(),
          supabase
            .from('configs')
            .select('junior_release_open')
            .order('id', { ascending: true })
            .limit(1)
            .maybeSingle(),
        ]);

        if (
          !performanceError &&
          !scheduleError &&
          !counterError &&
          !configError &&
          performanceData &&
          scheduleData
        ) {
          const counter = counterData as ClassTicketCounterRow | null;
          const remaining = calculateClassGeneralRemaining({
            totalCapacity: Number(performanceData.total_capacity ?? 0),
            juniorCapacity: Number(performanceData.junior_capacity ?? 0),
            issuedGeneral: Number(counter?.issued_general ?? 0),
            issuedJunior: Number(counter?.issued_junior ?? 0),
            issuedOther: Number(counter?.issued_other ?? 0),
            isJuniorReleased: Boolean(configData?.junior_release_open),
          });

          if (remaining > 0) {
            const classTicketTypeId = pickTicketTypeIdForVenue('class');
            if (classTicketTypeId !== null) {
              setSelectedTicketTypeId(classTicketTypeId);
            }

            setSelectedPerformance({
              performanceId: performanceData.id,
              performanceName: performanceData.class_name,
              scheduleId: scheduleData.id,
              scheduleName: scheduleData.round_name,
              remaining,
            });
            setStep(3);
          }
        }
      }

      // すべての読み込みが終わってから初期化フラグを下ろす
      setIsInitializing(false);
    };

    void loadSelectionFromQuery();
  }, [
    issueControls,
    remainingIssueCapacity,
    ownClubs,
    selectionFromQueryHasRun,
  ]);

  // selectedPerformance の変更を追跡（アラート表示判定用）
  useEffect(() => {
    if (selectedPerformance) {
      prevSelectedPerformanceRef.current = selectedPerformance;
    }
  }, [selectedPerformance]);

  const selectedTicketType = useMemo(
    () =>
      ticketTypes.find(
        (ticketType) => ticketType.id === selectedTicketTypeId,
      ) ?? null,
    [ticketTypes, selectedTicketTypeId],
  );
  const isAdmissionOnlyTicket =
    selectedTicketType?.name === ADMISSION_ONLY_TICKET_NAME;
  const isGymPerformanceTicket = Boolean(
    selectedTicketType?.name.includes(GYM_TICKET_KEYWORD),
  );
  const hasAnyActiveTicketType = useMemo(
    () => activeTicketTypes.some((ticketType) => ticketType.is_active),
    [activeTicketTypes],
  );
  const isIssueReceptionStopped =
    !isTicketIssuingEnabled || !hasAnyActiveTicketType;
  const restrictedClassName =
    selectedTicketType?.id === CLASS_INVITE_TICKET_ID &&
    classInviteMode === 'only-own'
      ? (ownClassName ?? '__NO_CLASS__')
      : null;
  const restrictedGroupNames =
    selectedTicketType?.id === GYM_INVITE_TICKET_ID &&
    issueControls?.gym_invite_mode === 'only-own'
      ? (ownClubs ?? [])
      : null;

  useEffect(() => {
    if (!selectedTicketType) {
      return;
    }

    if (isAdmissionOnlyTicket) {
      if (
        !selectedPerformance ||
        selectedPerformance.performanceId !== 0 ||
        selectedPerformance.scheduleId !== 0
      ) {
        setSelectedPerformance({
          performanceId: 0,
          performanceName: '-',
          scheduleId: 0,
          scheduleName: '-',
          remaining: 0,
        });
      }
      return;
    }

    if (
      selectedPerformance &&
      selectedPerformance.performanceId === 0 &&
      selectedPerformance.scheduleId === 0
    ) {
      setSelectedPerformance(null);
      return;
    }

    if (!selectedPerformance) {
      return;
    }

    const isGymSelection =
      selectedPerformance.performanceId > 0 &&
      selectedPerformance.scheduleId === 0;

    if (isGymPerformanceTicket && !isGymSelection) {
      setSelectedPerformance(null);
      return;
    }

    if (!isGymPerformanceTicket && isGymSelection) {
      setSelectedPerformance(null);
    }
  }, [
    isAdmissionOnlyTicket,
    isGymPerformanceTicket,
    selectedPerformance,
    selectedTicketType,
  ]);

  const selectedCellKey = selectedPerformance
    ? selectedPerformance.performanceId > 0
      ? `${selectedPerformance.performanceId}-${selectedPerformance.scheduleId}`
      : undefined
    : undefined;
  const selectedRelationshipName =
    selectedRelationshipId === null
      ? null
      : (relationships.find(
          (relationship) => relationship.id === selectedRelationshipId,
        )?.name ?? `間柄${selectedRelationshipId}`);
  const isOtherClassSelection = Boolean(
    selectedTicketType?.id === CLASS_INVITE_TICKET_ID &&
    selectedPerformance &&
    ownClassName !== null &&
    selectedPerformance.performanceName !== ownClassName,
  );
  const isOtherGymSelection = Boolean(
    selectedTicketType?.id === GYM_INVITE_TICKET_ID &&
    selectedPerformance &&
    ownClubs !== null &&
    !ownClubs.includes(selectedPerformance.performanceName),
  );
  const isRelationshipRestrictedToSelf =
    (classInviteMode === 'outside-own-self-only' && isOtherClassSelection) ||
    (issueControls?.gym_invite_mode === 'outside-own-self-only' &&
      isOtherGymSelection);
  const availableRelationships = useMemo(
    () =>
      isRelationshipRestrictedToSelf
        ? relationships.filter((relationship) => relationship.id === 1)
        : relationships,
    [isRelationshipRestrictedToSelf, relationships],
  );

  useEffect(() => {
    if (
      isRelationshipRestrictedToSelf &&
      selectedRelationshipId !== null &&
      selectedRelationshipId !== 1
    ) {
      setSelectedRelationshipId(null);
    }
  }, [isRelationshipRestrictedToSelf, selectedRelationshipId]);

  const canSubmit =
    Boolean(selectedTicketType) &&
    Boolean(selectedPerformance) &&
    selectedRelationshipId !== null &&
    issueCount > 0;
  const isSelectedEntryOnlyTicket = selectedTicketType?.id === 4;
  const selectedRemainingIssueCapacity =
    remainingIssueCapacity === null
      ? null
      : isGymPerformanceTicket
        ? selectedPerformance?.performanceId &&
          gymRemainingByPerformanceId.has(selectedPerformance.performanceId)
          ? (gymRemainingByPerformanceId.get(
              selectedPerformance.performanceId,
            ) ?? null)
          : null
        : selectedPerformance?.performanceId === classRemainingPerformanceId
          ? remainingIssueCapacity.class
          : null;
  const isAtClassIssueLimit =
    remainingIssueCapacity !== null &&
    selectedPerformance?.performanceId === classRemainingPerformanceId &&
    remainingIssueCapacity.class <= 0;
  const isAtGymIssueLimit =
    isGymPerformanceTicket &&
    selectedPerformance?.performanceId !== undefined &&
    (gymRemainingByPerformanceId.get(selectedPerformance.performanceId) ?? 1) <=
      0;
  const isAtAllIssueLimits = isAtClassIssueLimit && isAtGymIssueLimit;
  const reachedClassNames = [...classRemainingByPerformanceId]
    .filter(([, remaining]) => remaining <= 0)
    .map(([id]) => classPerformanceNames.get(id))
    .filter((name): name is string => Boolean(name));
  const reachedPerformanceNames = [
    ...new Set([
      ...reachedClassNames,
      ...[...gymRemainingByPerformanceId]
        .filter(([, remaining]) => remaining <= 0)
        .map(([id]) => gymPerformanceNames.get(id))
        .filter((name): name is string => Boolean(name)),
    ]),
  ];
  const isAtIssueLimit =
    !isSelectedEntryOnlyTicket &&
    selectedRemainingIssueCapacity !== null &&
    selectedRemainingIssueCapacity <= 0;
  const isOverRemainingIssueCapacity =
    !isSelectedEntryOnlyTicket &&
    selectedRemainingIssueCapacity !== null &&
    issueCount > selectedRemainingIssueCapacity;
  const maxSelectableIssueCount =
    selectedRemainingIssueCapacity === null || isSelectedEntryOnlyTicket
      ? MAX_ISSUE_COUNT
      : Math.max(1, Math.min(MAX_ISSUE_COUNT, selectedRemainingIssueCapacity));

  useEffect(() => {
    if (
      selectedRemainingIssueCapacity === null ||
      selectedRemainingIssueCapacity <= 0
    ) {
      return;
    }

    if (issueCount > maxSelectableIssueCount) {
      setIssueCount(maxSelectableIssueCount);
    }
  }, [issueCount, maxSelectableIssueCount, selectedRemainingIssueCapacity]);

  const shouldShowOnlyOwnClassAlert = useMemo(() => {
    if (
      classInviteMode !== 'only-own' ||
      !ownClassName ||
      !selectedTicketType
    ) {
      return false;
    }

    // クラス招待券ではない場合は表示しない
    if (selectedTicketType.id !== CLASS_INVITE_TICKET_ID) {
      return false;
    }

    if (isAdmissionOnlyTicket) {
      return false;
    }

    // 現在の selectedPerformance がない場合、前の値を使用
    const targetPerformance =
      selectedPerformance || prevSelectedPerformanceRef.current;

    if (!targetPerformance) {
      return false;
    }

    // 体育館公演（performanceId > 0 && scheduleId === 0）の場合は表示しない
    if (
      targetPerformance.performanceId > 0 &&
      targetPerformance.scheduleId === 0
    ) {
      return false;
    }

    // クラス公演で、選択されたクラスが自分のクラスと異なる場合に表示
    const shouldShow = targetPerformance.performanceName !== ownClassName;
    return shouldShow;
  }, [
    classInviteMode,
    ownClassName,
    selectedPerformance,
    selectedTicketType,
    isAdmissionOnlyTicket,
  ]);

  const shouldShowOnlyOwnGymAlert = useMemo(() => {
    if (
      issueControls?.gym_invite_mode !== 'only-own' ||
      !ownClubs ||
      !selectedTicketType
    ) {
      return false;
    }

    if (selectedTicketType.id !== GYM_INVITE_TICKET_ID) {
      return false;
    }

    const targetPerformance =
      selectedPerformance || prevSelectedPerformanceRef.current;

    if (!targetPerformance) {
      return false;
    }

    const isGymSelection =
      targetPerformance.performanceId > 0 && targetPerformance.scheduleId === 0;

    if (!isGymSelection) {
      return false;
    }

    return !ownClubs.includes(targetPerformance.performanceName);
  }, [
    issueControls?.gym_invite_mode,
    ownClubs,
    selectedPerformance,
    selectedTicketType,
  ]);

  const transitionToStep = (nextStep: Step) => {
    if (nextStep === step) {
      return;
    }

    if (animationTimerRef.current !== null) {
      window.clearTimeout(animationTimerRef.current);
    }

    const movingForward = nextStep > step;
    setIsForward(movingForward);
    setLeavingStep(step);
    setStep(nextStep);

    if (movingForward) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }

    animationTimerRef.current = window.setTimeout(() => {
      setLeavingStep(null);
      animationTimerRef.current = null;
    }, PANEL_ANIMATION_MS);
  };

  const getPanelClassName = (panelStep: Step) => {
    if (panelStep === step) {
      if (leavingStep === null) {
        return `${styles.stepPanel} ${styles.panelVisible}`;
      }

      return `${styles.stepPanel} ${styles.panelVisible} ${
        isForward ? styles.panelEnterFromRight : styles.panelEnterFromLeft
      }`;
    }

    if (panelStep === leavingStep) {
      return `${styles.stepPanel} ${styles.panelLeaving} ${
        isForward ? styles.panelExitToLeft : styles.panelExitToRight
      }`;
    }

    return `${styles.stepPanel} ${styles.panelHidden}`;
  };

  const handleIssue = async () => {
    if (isIssueReceptionStopped) {
      alert('現在チケット発券は受付停止中です。');
      return;
    }

    if (!canSubmit || !selectedPerformance || !selectedTicketType) {
      return;
    }

    setIsIssuing(true);
    setHasOtherPerformanceTotalLimitError(false);

    const isGymSelection =
      selectedPerformance.performanceId > 0 &&
      selectedPerformance.scheduleId === 0;

    const [
      { data: performanceTitle },
      { data: scheduleData },
      { data: gymPerformanceData },
      { data: configData },
    ] = await Promise.all([
      !isGymSelection && selectedPerformance.performanceId > 0
        ? supabase
            .from('class_performances')
            .select('title')
            .eq('id', selectedPerformance.performanceId)
            .maybeSingle()
        : { data: null },
      selectedPerformance.scheduleId > 0
        ? supabase
            .from('performances_schedule')
            .select('start_at, end_at')
            .eq('id', selectedPerformance.scheduleId)
            .maybeSingle()
        : { data: null },
      isGymSelection
        ? supabase
            .from('gym_performances')
            .select('start_at')
            .eq('id', selectedPerformance.performanceId)
            .maybeSingle()
        : { data: null },
      supabase
        .from('configs')
        .select('show_length')
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    // Calculate schedule date/time
    let scheduleDate = '-';
    let scheduleTime = '';
    let scheduleEndTime = '';

    if (selectedPerformance.scheduleId === 0) {
      if (selectedPerformance.performanceId === 0) {
        // Admission only
        const eventDates = (config.date ?? []).filter(
          (date) => typeof date === 'string' && date.length > 0,
        );
        scheduleDate = formatDateText(eventDates) || '-';
        scheduleTime = '';
        scheduleEndTime = '';
      } else if (gymPerformanceData?.start_at) {
        const snapshot = (gymPerformanceSnapshot.gymPerformances ?? []).find(
          (performance) => performance.id === selectedPerformance.performanceId,
        );
        const startAt = snapshot?.start_at
          ? new Date(snapshot.start_at)
          : new Date(gymPerformanceData.start_at);
        const gymEndAt = (gymPerformanceData as { end_at?: string | null })
          .end_at;
        const endAt = snapshot?.end_at
          ? new Date(snapshot.end_at)
          : gymEndAt
            ? new Date(gymEndAt)
            : null;

        scheduleDate = startAt.toLocaleDateString('ja-JP', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
        scheduleTime = startAt.toLocaleTimeString('ja-JP', {
          hour: '2-digit',
          minute: '2-digit',
        });
        scheduleEndTime = endAt
          ? endAt.toLocaleTimeString('ja-JP', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '-';
      } else {
        scheduleDate = '-';
        scheduleTime = '-';
        scheduleEndTime = '-';
      }
    } else if (scheduleData?.start_at) {
      const startAt = new Date(scheduleData.start_at);
      const showLengthMinutes = Number(configData?.show_length ?? 0);
      const endAt = startAt
        ? new Date(startAt.getTime() + showLengthMinutes * 60 * 1000)
        : null;

      scheduleDate = startAt.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      scheduleTime = startAt.toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
      });
      scheduleEndTime = endAt
        ? endAt.toLocaleTimeString('ja-JP', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '-';
    }

    const { data, error } = await supabase.functions.invoke('issue-tickets', {
      body: {
        ticketTypeId: selectedTicketType.id,
        relationshipId: selectedRelationshipId,
        performanceId: selectedPerformance.performanceId,
        scheduleId: selectedPerformance.scheduleId,
        issueCount,
      },
    });

    if (error) {
      const detailedMessage = await readFunctionErrorMessage(error);
      setHasOtherPerformanceTotalLimitError(
        detailedMessage.includes('他クラス・部活の合計発行可能枚数'),
      );
      alert(`発券に失敗しました: ${detailedMessage}`);
      setIsIssuing(false);
      return;
    }

    const issuedTickets = (
      data as {
        issuedTickets?: Array<{ code: string; signature: string }>;
      } | null
    )?.issuedTickets;

    if (!issuedTickets || issuedTickets.length === 0) {
      alert('発券結果を取得できませんでした。');
      setIsIssuing(false);
      return;
    }

    window.sessionStorage.setItem(
      ISSUE_RESULT_STORAGE_KEY,
      JSON.stringify({
        performanceName:
          selectedPerformance.performanceId === 0 &&
          selectedPerformance.scheduleId === 0
            ? ADMISSION_ONLY_TICKET_NAME
            : selectedPerformance.performanceName,
        performanceTitle: performanceTitle?.title,
        scheduleName: selectedPerformance.scheduleName,
        scheduleDate,
        scheduleTime,
        scheduleEndTime,
        ticketTypeLabel: formatTicketTypeLabel({
          type: selectedTicketType.type,
          name: selectedTicketType.name,
        }),
        relationshipName: selectedRelationshipName ?? '-',
        relationshipId: selectedRelationshipId ?? 1,
        issuedTickets,
      }),
    );
    setIssueCount(1);
    setSelectedRelationshipId(null);
    setIsIssuing(false);
    route('/students/issue/result');
  };

  const isInitialLoading = !issueControls || ticketTypes.length === 0;

  if (isInitialLoading) {
    return (
      <div className={styles.issuePage}>
        <BackButton href='/students/dashboard' />
        <h1 className={styles.pageTitle}>チケット発券</h1>
        <LoadingSpinner />
      </div>
    );
  }

  if (isIssueReceptionStopped) {
    return (
      <div className={styles.issuePage}>
        <BackButton href='/students/dashboard' />
        <h1 className={styles.pageTitle}>チケット発券</h1>
        <Alert type='warning'>
          <p>現在チケット発券は受付停止中です。</p>
        </Alert>
      </div>
    );
  }

  return (
    <div className={styles.issuePage}>
      <BackButton href='/students/dashboard' />
      <h1 className={styles.pageTitle}>チケット発券</h1>
      {shouldShowOnlyOwnClassAlert && (
        <Alert type='info' className={styles.onlyOwnClassAlert}>
          <p>現在自クラスのみ発券可能です。</p>
        </Alert>
      )}
      {shouldShowOnlyOwnGymAlert && (
        <Alert type='info' className={styles.onlyOwnClassAlert}>
          <p>現在自部活のみ発券可能です。</p>
        </Alert>
      )}
      {isAtAllIssueLimits ? (
        <Alert type='warning' className={styles.onlyOwnClassAlert}>
          <p>
            最大発行可能枚数に達しているため、入場専用券のみ発券できます。さらに必要な場合は、不要なチケットをキャンセルするか、友達からもらってください。
          </p>
        </Alert>
      ) : null}
      {hasOtherPerformanceTotalLimitError ||
      otherPerformanceTotalRemaining === 0 ? (
        <Alert type='warning' className={styles.onlyOwnClassAlert}>
          <p>他クラス・部活の合計発行可能枚数に達しています。</p>
        </Alert>
      ) : (
        reachedPerformanceNames.length > 0 && (
          <Alert type='info' className={styles.onlyOwnClassAlert}>
            <p>発行上限に達している公演：</p>
            <ul>
              {reachedPerformanceNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </Alert>
        )
      )}
      {isAtClassIssueLimit && !isAtAllIssueLimits && (
        <Alert type='info' className={styles.onlyOwnClassAlert}>
          <p>
            クラス公演のチケット発行上限に達しています。さらに必要な場合は、不要なチケットをキャンセルするか、友達からもらってください。
          </p>
        </Alert>
      )}
      {isAtGymIssueLimit && !isAtAllIssueLimits && (
        <Alert type='info' className={styles.onlyOwnClassAlert}>
          <p>
            体育館公演のチケット発行上限に達しています。さらに必要な場合は、不要なチケットをキャンセルするか、友達からもらってください。
          </p>
        </Alert>
      )}
      {selectedPerformance &&
        selectedPerformance.performanceId > 0 &&
        selectedPerformance.scheduleId > 0 &&
        selectedPerformance.performanceId === classRemainingPerformanceId &&
        remainingIssueCapacity !== null && (
          <Alert type='info' className={styles.onlyOwnClassAlert}>
            <p>
              このクラスのチケットは、あと{remainingIssueCapacity.class}
              枚発行できます。
            </p>
          </Alert>
        )}
      {selectedPerformance &&
        selectedPerformance.performanceId > 0 &&
        selectedPerformance.scheduleId === 0 &&
        gymRemainingByPerformanceId.has(selectedPerformance.performanceId) && (
          <Alert type='info' className={styles.onlyOwnClassAlert}>
            <p>
              この部活のチケットは、あと
              {gymRemainingByPerformanceId.get(
                selectedPerformance.performanceId,
              ) ?? 0}
              枚発行できます。
            </p>
          </Alert>
        )}

      <div className={styles.sliderViewport}>
        <div className={getPanelClassName(1)}>
          <IssueStepTicketType
            options={activeTicketTypes}
            selectedTicketTypeId={selectedTicketTypeId}
            onSelectTicketType={setSelectedTicketTypeId}
          />
        </div>

        <div className={getPanelClassName(2)}>
          <IssueStepPerformance
            isGymPerformanceTicket={isGymPerformanceTicket}
            selectedPerformance={selectedPerformance}
            selectedCellKey={selectedCellKey}
            restrictedClassName={restrictedClassName}
            restrictedGroupNames={restrictedGroupNames}
            hiddenClassPerformanceIds={
              new Set(
                [...classRemainingByPerformanceId]
                  .filter(([, remaining]) => remaining <= 0)
                  .map(([id]) => id),
              )
            }
            nonInteractiveGymPerformanceIds={
              new Set(
                [...gymRemainingByPerformanceId]
                  .filter(([, remaining]) => remaining <= 0)
                  .map(([id]) => id),
              )
            }
            hiddenGymGroupNames={
              new Set(
                [...gymRemainingByPerformanceId]
                  .filter(([, remaining]) => remaining <= 0)
                  .map(([id]) => gymPerformanceNames.get(id))
                  .filter((name): name is string => Boolean(name)),
              )
            }
            onSelectPerformance={setSelectedPerformance}
          />
        </div>

        <div className={getPanelClassName(3)}>
          <IssueStepDetails
            relationships={availableRelationships}
            relationshipLoading={relationshipLoading}
            relationshipError={relationshipError}
            selectedRelationshipId={selectedRelationshipId}
            issueCount={issueCount}
            maxIssueCount={maxSelectableIssueCount}
            selectedTicketType={selectedTicketType}
            selectedPerformance={selectedPerformance}
            onSelectRelationshipId={setSelectedRelationshipId}
            onSelectIssueCount={setIssueCount}
          />
        </div>
        <div className={styles.actions}>
          <div className={styles.progressSection}>
            {(() => {
              const totalSteps = isAdmissionOnlyTicket ? 2 : 3;
              const displayedStep =
                isAdmissionOnlyTicket && step === 3 ? 2 : step;

              return (
                <>
                  <progress
                    className={styles.progressBar}
                    max={totalSteps}
                    value={displayedStep}
                  ></progress>
                  <p className={styles.stepIndicator}>
                    STEP {displayedStep} / {totalSteps}
                  </p>
                </>
              );
            })()}
          </div>
          <button
            type='button'
            className={styles.backButton}
            onClick={() => {
              if (step === 3 && isAdmissionOnlyTicket) {
                transitionToStep(1);
                return;
              }

              if (step > 1) {
                transitionToStep((step - 1) as Step);
              }
            }}
            style={step === 1 ? { visibility: 'hidden' } : undefined}
          >
            戻る
          </button>
          <div>
            <button
              type='button'
              className={styles.nextButton}
              onClick={() => {
                if (step === 1) {
                  transitionToStep(isAdmissionOnlyTicket ? 3 : 2);
                  return;
                }

                if (step === 2) {
                  transitionToStep(3);
                }
              }}
              disabled={
                (step === 1 && !selectedTicketType) ||
                (step === 2 && !selectedPerformance) ||
                step === 3
              }
              style={step === 3 ? { display: 'none' } : undefined}
            >
              次へ
            </button>
            <button
              type='button'
              className={styles.generateButton}
              onClick={handleIssue}
              disabled={
                !canSubmit ||
                isIssuing ||
                !isTicketIssuingEnabled ||
                isAtIssueLimit ||
                isOverRemainingIssueCapacity
              }
              style={step !== 3 ? { display: 'none' } : undefined}
            >
              {isIssuing ? '発券中...' : '発券する'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Issue;
