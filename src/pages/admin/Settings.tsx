import Alert from '../../components/ui/Alert';
import NormalSection from '../../components/ui/NormalSection';
import { useEffect, useState } from 'preact/hooks';
import { supabase } from '../../lib/supabase';
import styles from './Settings.module.css';
import Switch from '../../components/ui/Switch';
import { useTitle } from '../../hooks/useTitle';
import { useEventConfig } from '../../hooks/useEventConfig';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import {
  AdminAuthLayout,
  getSessionToken,
  readErrorMessage,
} from '../../layout/AdminAuthLayout';

type ControlPanelSettings = {
  eventYear: number;
  showLength: number;
  maxTicketsPerOtherClassUser: number;
  maxTicketsPerOtherPerformanceUser: number;
  classTicketLimits: {
    id: number;
    class_name: string;
    max_tickets_per_user: number;
  }[];
  maxTicketsPerOtherClubUser: number;
  maxOfficialRehearsalTicketsPerUser: number;
  showPublicRehearsalDashboard: boolean;
  gymTicketLimitsByClub: Record<string, number>;
  maxTicketsPerJuniorUser: number;
  maxAdmissionOnlyJuniorAccounts: number;
  juniorReleaseOpen: boolean;
  ticketIssuingEnabled: boolean;
  maintenanceMode: boolean;
  maintenanceEndsAt: string | null;
  activeTicketTypeIds: number[];
  defaultClassTotalCapacity: number;
  defaultClassJuniorCapacity: number;
  defaultGymCapacity: number;
  defaultGymJuniorCapacity: number;
  hasMultipleClassTotalCapacities: boolean;
  hasMultipleClassJuniorCapacities: boolean;
  hasMultipleGymCapacities: boolean;
  hasMultipleGymJuniorCapacities: boolean;
};

type TicketTypeControlValue =
  | 'open'
  | 'only-own'
  | 'outside-own-self-only'
  | 'public-rehearsals'
  | 'self-rehearsals'
  | 'auto'
  | 'off';

type TicketTypeControlKey =
  | 'classInvite'
  | 'rehearsalInvite'
  | 'gymInvite'
  | 'entryOnly'
  | 'sameDayClass'
  | 'sameDayGym'
  | 'juniorClass'
  | 'juniorGym'
  | 'juniorEntryOnly';

type TicketTypeControls = Record<TicketTypeControlKey, TicketTypeControlValue>;

const TICKET_TYPE_IDS = {
  classInvite: 1,
  rehearsalInvite: 2,
  gymInvite: 3,
  entryOnly: 4,
  sameDayClass: 8,
  sameDayGym: 9,
  juniorClass: 5,
  juniorGym: 6,
  juniorEntryOnly: 7,
} as const;

const DEFAULT_TICKET_TYPE_CONTROLS: TicketTypeControls = {
  classInvite: 'open',
  rehearsalInvite: 'open',
  gymInvite: 'open',
  entryOnly: 'open',
  sameDayClass: 'open',
  sameDayGym: 'open',
  juniorClass: 'open',
  juniorGym: 'open',
  juniorEntryOnly: 'open',
};

const buildActiveTicketTypeIds = (controls: TicketTypeControls): number[] => {
  const activeIds = new Set<number>();
  if (controls.classInvite !== 'off') {
    activeIds.add(TICKET_TYPE_IDS.classInvite);
  }
  if (controls.rehearsalInvite !== 'off') {
    activeIds.add(TICKET_TYPE_IDS.rehearsalInvite);
  }
  if (controls.gymInvite !== 'off') {
    activeIds.add(TICKET_TYPE_IDS.gymInvite);
  }
  if (controls.entryOnly !== 'off') {
    activeIds.add(TICKET_TYPE_IDS.entryOnly);
  }
  if (controls.sameDayClass !== 'off') {
    activeIds.add(TICKET_TYPE_IDS.sameDayClass);
  }
  if (controls.sameDayGym !== 'off') {
    activeIds.add(TICKET_TYPE_IDS.sameDayGym);
  }
  if (controls.juniorClass !== 'off') {
    activeIds.add(TICKET_TYPE_IDS.juniorClass);
  }
  if (controls.juniorGym !== 'off') {
    activeIds.add(TICKET_TYPE_IDS.juniorGym);
  }
  if (controls.juniorEntryOnly !== 'off') {
    activeIds.add(TICKET_TYPE_IDS.juniorEntryOnly);
  }
  return Array.from(activeIds);
};

const toLocalDateTimeInputValue = (value: string): string => {
  const date = new Date(value);
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const mapActiveIdsToTicketTypeControls = (
  activeTicketTypeIds: number[],
): TicketTypeControls => {
  const activeIdSet = new Set(activeTicketTypeIds);
  return {
    classInvite: activeIdSet.has(TICKET_TYPE_IDS.classInvite) ? 'open' : 'off',
    rehearsalInvite: activeIdSet.has(TICKET_TYPE_IDS.rehearsalInvite)
      ? 'open'
      : 'off',
    gymInvite: activeIdSet.has(TICKET_TYPE_IDS.gymInvite) ? 'open' : 'off',
    entryOnly: activeIdSet.has(TICKET_TYPE_IDS.entryOnly) ? 'open' : 'off',
    sameDayClass: activeIdSet.has(TICKET_TYPE_IDS.sameDayClass)
      ? 'open'
      : 'off',
    sameDayGym: activeIdSet.has(TICKET_TYPE_IDS.sameDayGym) ? 'open' : 'off',
    juniorClass: activeIdSet.has(TICKET_TYPE_IDS.juniorClass) ? 'open' : 'off',
    juniorGym: activeIdSet.has(TICKET_TYPE_IDS.juniorGym) ? 'open' : 'off',
    juniorEntryOnly: activeIdSet.has(TICKET_TYPE_IDS.juniorEntryOnly)
      ? 'open'
      : 'off',
  };
};

const isTicketTypeControlValue = (
  value: unknown,
): value is TicketTypeControlValue =>
  value === 'open' ||
  value === 'only-own' ||
  value === 'outside-own-self-only' ||
  value === 'public-rehearsals' ||
  value === 'self-rehearsals' ||
  value === 'auto' ||
  value === 'off';

const NUMERIC_SETTING_META = {
  eventYear: { label: '年度', min: 2020, max: 2100 },
  showLength: { label: '1公演の長さ（分）', min: 1, max: 300 },
  maxTicketsPerOtherClassUser: {
    label: '他クラスの1クラスあたりの発行可能枚数',
    min: 0,
    max: 100,
  },
  maxTicketsPerOtherPerformanceUser: {
    label: '他クラス・部活の合計発行可能枚数',
    min: 0,
    max: 500,
  },
  maxTicketsPerOtherClubUser: {
    label: '他部活の1部活あたり発行上限',
    min: 1,
    max: 100,
  },
  maxOfficialRehearsalTicketsPerUser: {
    label: '公開リハの生徒1人あたり発行上限',
    min: 0,
    max: 100,
  },
  maxTicketsPerJuniorUser: {
    label: '中学生のチケット購入上限',
    min: 1,
    max: 100,
  },
  maxAdmissionOnlyJuniorAccounts: {
    label: '入場専用券のみ登録可能な中学生アカウント上限',
    min: 0,
    max: 800,
  },
  defaultClassTotalCapacity: {
    label: 'クラス公演の定員(合計)',
    min: 1,
    max: 1000,
  },
  defaultClassJuniorCapacity: {
    label: 'クラス公演の中学生枠',
    min: 0,
    max: 1000,
  },
  defaultGymCapacity: { label: '体育館公演の定員', min: 1, max: 2000 },
  defaultGymJuniorCapacity: {
    label: '体育館公演の中学生枠',
    min: 0,
    max: 2000,
  },
} as const;

type NumericSettingKey = keyof typeof NUMERIC_SETTING_META;
type TicketCapacitySettingKey =
  | 'defaultClassTotalCapacity'
  | 'defaultClassJuniorCapacity'
  | 'defaultGymCapacity'
  | 'defaultGymJuniorCapacity';
type SettingsMessageScope =
  | 'modal'
  | 'globalSection'
  | 'ticketSection'
  | 'detailSection'
  | 'deletionTool'
  | null;
type AccountDeletionType = 'student' | 'junior';

const SettingsContent = () => {
  const { config } = useEventConfig();
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
  const [settings, setSettings] = useState<ControlPanelSettings>({
    eventYear: 2026,
    showLength: 60,
    maxTicketsPerOtherClassUser: 20,
    maxTicketsPerOtherPerformanceUser: 40,
    classTicketLimits: [],
    maxTicketsPerOtherClubUser: 20,
    maxOfficialRehearsalTicketsPerUser: 1,
    showPublicRehearsalDashboard: true,
    gymTicketLimitsByClub: {},
    maxTicketsPerJuniorUser: 2,
    maxAdmissionOnlyJuniorAccounts: 100,
    juniorReleaseOpen: false,
    ticketIssuingEnabled: true,
    maintenanceMode: false,
    maintenanceEndsAt: null,
    activeTicketTypeIds: [
      TICKET_TYPE_IDS.classInvite,
      TICKET_TYPE_IDS.rehearsalInvite,
      TICKET_TYPE_IDS.gymInvite,
      TICKET_TYPE_IDS.entryOnly,
      TICKET_TYPE_IDS.sameDayClass,
      TICKET_TYPE_IDS.sameDayGym,
    ],
    defaultClassTotalCapacity: 40,
    defaultClassJuniorCapacity: 5,
    defaultGymCapacity: 300,
    defaultGymJuniorCapacity: 0,
    hasMultipleClassTotalCapacities: false,
    hasMultipleClassJuniorCapacities: false,
    hasMultipleGymCapacities: false,
    hasMultipleGymJuniorCapacities: false,
  });
  const [ticketTypeControls, setTicketTypeControls] =
    useState<TicketTypeControls>(DEFAULT_TICKET_TYPE_CONTROLS);
  const [isSettingsLoading, setIsSettingsLoading] = useState(false);
  const [isRedeploying, setIsRedeploying] = useState(false);
  const [isSyncingSetting, setIsSyncingSetting] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);
  const [settingsMessageScope, setSettingsMessageScope] =
    useState<SettingsMessageScope>(null);
  const [schedules, setSchedules] = useState<
    { id: number; round_name: string; start_at: string; is_active: boolean }[]
  >([]);
  const [editingSchedule, setEditingSchedule] = useState<{
    id: number;
    roundName: string;
    startAt: string;
    isActive: boolean;
  } | null>(null);
  const [relationships, setRelationships] = useState<
    { id: number; name: string; is_accepting: boolean }[]
  >([]);
  const [gymClubs, setGymClubs] = useState<string[]>([]);
  const [editingNumericKey, setEditingNumericKey] =
    useState<NumericSettingKey | null>(null);
  const [editingNumericValue, setEditingNumericValue] = useState('');
  const [editingGymClub, setEditingGymClub] = useState<string | null>(null);
  const [editingGymClubLimit, setEditingGymClubLimit] = useState('');
  const [editingClassLimitId, setEditingClassLimitId] = useState<number | null>(
    null,
  );
  const [editingClassLimit, setEditingClassLimit] = useState('');
  const [isBulkClassLimitModalOpen, setIsBulkClassLimitModalOpen] =
    useState(false);
  const [isMaintenanceEndModalOpen, setIsMaintenanceEndModalOpen] =
    useState(false);
  const [maintenanceEndsAtDraft, setMaintenanceEndsAtDraft] = useState('');
  const [bulkClassLimit, setBulkClassLimit] = useState('');
  const [activeDetailTab, setActiveDetailTab] = useState<
    'schedules' | 'relationships'
  >('schedules');
  const [isModalSubmitting, setIsModalSubmitting] = useState(false);
  const [juniorPassword, setJuniorPassword] = useState('');
  const [juniorPasswordConfirm, setJuniorPasswordConfirm] = useState('');
  const [hasJuniorPassword, setHasJuniorPassword] = useState(false);
  const [isUpdatingJuniorPassword, setIsUpdatingJuniorPassword] =
    useState(false);
  const [juniorPasswordError, setJuniorPasswordError] = useState<string | null>(
    null,
  );
  const [juniorPasswordSuccess, setJuniorPasswordSuccess] = useState<
    string | null
  >(null);

  useTitle('コントロールパネル - 管理画面');

  const handlePasswordChange = async (event: Event) => {
    setSettingsMessageScope(null); // Clear any previous messages

    event.preventDefault();
    setPasswordChangeError(null);
    setPasswordChangeSuccess(null);

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
      const { data, error } = await supabase.functions.invoke('admin-auth', {
        body: {
          action: 'changePassword',
          currentPassword,
          newPassword,
        },
        headers: {
          'x-admin-session-token': getSessionToken() ?? '',
        },
      });

      if (error) {
        throw error;
      }

      if (!data?.changed) {
        setPasswordChangeError(
          'パスワード変更に失敗しました。時間をおいて再度お試しください。',
        );
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setPasswordChangeSuccess('管理者パスワードを変更しました。');
    } catch (error) {
      const message = await readErrorMessage(error);
      setPasswordChangeError(`パスワード変更に失敗しました。${message}`);
    } finally {
      setIsChangingPassword(false);
    }
  };

  const [showDeleteAllAccountsModal, setShowDeleteAllAccountsModal] =
    useState(false);
  const [showDeleteAllTicketsModal, setShowDeleteAllTicketsModal] =
    useState(false);
  const [showDeleteAllLeaderboardModal, setShowDeleteAllLeaderboardModal] =
    useState(false);
  const [showResetAllLikesModal, setShowResetAllLikesModal] = useState(false);
  const [
    showDeleteAllOrganizationAdminsModal,
    setShowDeleteAllOrganizationAdminsModal,
  ] = useState(false);
  const [pendingDeleteAccountType, setPendingDeleteAccountType] =
    useState<AccountDeletionType>('student');
  const [isDeletingAllAccounts, setIsDeletingAllAccounts] = useState(false);
  const [isDeletingAllTickets, setIsDeletingAllTickets] = useState(false);
  const [isDeletingAllLeaderboard, setIsDeletingAllLeaderboard] =
    useState(false);
  const [isResettingAllLikes, setIsResettingAllLikes] = useState(false);
  const [isDeletingAllOrganizationAdmins, setIsDeletingAllOrganizationAdmins] =
    useState(false);

  const handleDeleteAllAccounts = async () => {
    setSettingsMessageScope('deletionTool');
    setSettingsError(null);
    setSettingsSuccess(null);
    setIsDeletingAllAccounts(true);
    setShowDeleteAllAccountsModal(false);
    let totalDeletedSoFar = 0;
    let juniorCountersWereReset = false;
    const accountType = pendingDeleteAccountType;
    const accountLabel =
      accountType === 'student' ? '生徒アカウント' : '中学生アカウント';

    try {
      const token = getSessionToken();
      if (!token) {
        throw new Error('セッションがありません。再ログインしてください。');
      }

      while (true) {
        const { data, error } = await supabase.functions.invoke('admin-auth', {
          body: {
            action: 'deleteAccountsByType',
            accountType,
          },
          headers: {
            'x-admin-session-token': token,
          },
        });

        if (error) {
          throw error;
        }

        if (!data?.deleted) {
          throw new Error('削除に失敗しました。');
        }

        totalDeletedSoFar += data.count;
        juniorCountersWereReset = data?.juniorCountersReset === true;

        if (data.remaining > 0) {
          setSettingsSuccess(
            `${accountLabel}を現在 ${totalDeletedSoFar} 件削除しました。5秒後に次のバッチを開始します...`,
          );
          await new Promise((resolve) => setTimeout(resolve, 5000));
        } else {
          break;
        }
      }

      setSettingsSuccess(
        `合計 ${totalDeletedSoFar} 件の${accountLabel}を削除しました。${accountType === 'junior' && juniorCountersWereReset ? ' 中学生アカウントの利用形態カウンターもリセットしました。' : ''}`,
      );
    } catch (error) {
      const message = await readErrorMessage(error);
      setSettingsError(`${accountLabel}の削除に失敗しました。${message}`);
    } finally {
      setIsDeletingAllAccounts(false);
      // 削除後、生徒アカウント管理ページの一覧を更新する必要があるが、
      // ここでは直接的な更新は行わず、ユーザーに手動更新を促すか、
      // ページ遷移を推奨する。
    }
  };

  const handleDeleteAllTickets = async () => {
    setSettingsMessageScope('deletionTool');
    setSettingsError(null);
    setSettingsSuccess(null);
    setIsDeletingAllTickets(true);
    setShowDeleteAllTicketsModal(false);

    try {
      const token = getSessionToken();
      if (!token) {
        throw new Error('セッションがありません。再ログインしてください。');
      }

      const { data, error } = await supabase.functions.invoke('admin-auth', {
        body: {
          action: 'deleteAllTicketsAndResetCounters',
        },
        headers: {
          'x-admin-session-token': token,
        },
      });

      if (error) {
        throw error;
      }

      if (!data?.deleted || !data?.countersReset) {
        throw new Error('チケット削除またはカウンターリセットに失敗しました。');
      }

      const deletedTicketCount =
        typeof data.deletedTicketCount === 'number'
          ? data.deletedTicketCount
          : 0;
      setSettingsSuccess(
        `合計 ${deletedTicketCount} 件のチケットを削除し、各種カウンターをリセットしました。`,
      );
    } catch (error) {
      const message = await readErrorMessage(error);
      setSettingsError(
        `チケット削除とカウンターリセットに失敗しました。${message}`,
      );
    } finally {
      setIsDeletingAllTickets(false);
    }
  };

  const handleDeleteAllLeaderboard = async () => {
    setSettingsMessageScope('deletionTool');
    setSettingsError(null);
    setSettingsSuccess(null);
    setIsDeletingAllLeaderboard(true);
    setShowDeleteAllLeaderboardModal(false);

    try {
      const token = getSessionToken();
      if (!token) {
        throw new Error('セッションがありません。再ログインしてください。');
      }

      const { data, error } = await supabase.functions.invoke('admin-auth', {
        body: { action: 'deleteAllFlappyLeaderboardEntries' },
        headers: { 'x-admin-session-token': token },
      });

      if (error) {
        throw error;
      }
      if (!data?.deleted) {
        throw new Error('ランキングの削除に失敗しました。');
      }

      setSettingsSuccess(
        `隠しミニゲームのランキングを ${data.deletedLeaderboardEntryCount ?? 0} 件削除しました。`,
      );
    } catch (error) {
      const message = await readErrorMessage(error);
      setSettingsError(`ランキングの削除に失敗しました。${message}`);
    } finally {
      setIsDeletingAllLeaderboard(false);
    }
  };

  const handleResetAllLikes = async () => {
    setSettingsMessageScope('deletionTool');
    setSettingsError(null);
    setSettingsSuccess(null);
    setIsResettingAllLikes(true);
    setShowResetAllLikesModal(false);

    try {
      const token = getSessionToken();
      if (!token) {
        throw new Error('セッションがありません。再ログインしてください。');
      }
      const { data, error } = await supabase.functions.invoke('admin-auth', {
        body: { action: 'resetAllPerformanceLikes' },
        headers: { 'x-admin-session-token': token },
      });
      if (error) {
        throw error;
      }
      if (!data?.reset) {
        throw new Error('いいねの消去に失敗しました。');
      }
      setSettingsSuccess('全ての公演・展示のいいねを消去しました。');
    } catch (error) {
      const message = await readErrorMessage(error);
      setSettingsError(`いいねの消去に失敗しました。${message}`);
    } finally {
      setIsResettingAllLikes(false);
    }
  };

  const handleDeleteAllOrganizationAdmins = async () => {
    setSettingsMessageScope('deletionTool');
    setSettingsError(null);
    setSettingsSuccess(null);
    setIsDeletingAllOrganizationAdmins(true);
    setShowDeleteAllOrganizationAdminsModal(false);

    try {
      const token = getSessionToken();
      if (!token) {
        throw new Error('セッションがありません。再ログインしてください。');
      }

      const { data, error } = await supabase.functions.invoke('admin-auth', {
        body: { action: 'deleteAllOrganizationAdmins' },
        headers: { 'x-admin-session-token': token },
      });

      if (error) {
        throw error;
      }
      if (!data?.deleted) {
        throw new Error('削除に失敗しました。');
      }

      setSettingsSuccess(
        `合計 ${data.count ?? 0} 件の管理者アカウントを削除しました。`,
      );
    } catch (error) {
      const message = await readErrorMessage(error);
      setSettingsError(`管理者アカウントの削除に失敗しました。${message}`);
    } finally {
      setIsDeletingAllOrganizationAdmins(false);
    }
  };

  useEffect(() => {
    let isActive = true;
    const token = getSessionToken();
    if (!token) {
      return;
    }

    const loadSettings = async () => {
      setIsSettingsLoading(true);
      setSettingsError(null);
      setSettingsSuccess(null);
      setSettingsMessageScope(null);

      try {
        const { data, error } = await supabase.functions.invoke('admin-auth', {
          body: { action: 'getSettings' },
          headers: {
            'x-admin-session-token': token,
          },
        });

        if (error) {
          throw error;
        }

        const nextSettings = data?.settings;
        if (
          !nextSettings ||
          typeof nextSettings.eventYear !== 'number' ||
          typeof nextSettings.showLength !== 'number' ||
          typeof nextSettings.maxTicketsPerOtherClassUser !== 'number' ||
          typeof nextSettings.maxTicketsPerOtherPerformanceUser !== 'number' ||
          !Array.isArray(nextSettings.classTicketLimits) ||
          typeof nextSettings.maxTicketsPerOtherClubUser !== 'number' ||
          typeof nextSettings.maxOfficialRehearsalTicketsPerUser !== 'number' ||
          typeof nextSettings.showPublicRehearsalDashboard !== 'boolean' ||
          !nextSettings.gymTicketLimitsByClub ||
          typeof nextSettings.gymTicketLimitsByClub !== 'object' ||
          Array.isArray(nextSettings.gymTicketLimitsByClub) ||
          typeof nextSettings.maxAdmissionOnlyJuniorAccounts !== 'number' ||
          typeof nextSettings.juniorReleaseOpen !== 'boolean' ||
          typeof nextSettings.ticketIssuingEnabled !== 'boolean' ||
          typeof nextSettings.maintenanceMode !== 'boolean' ||
          (nextSettings.maintenanceEndsAt !== null &&
            typeof nextSettings.maintenanceEndsAt !== 'string') ||
          typeof nextSettings.defaultClassTotalCapacity !== 'number' ||
          typeof nextSettings.defaultClassJuniorCapacity !== 'number' ||
          typeof nextSettings.defaultGymCapacity !== 'number' ||
          typeof nextSettings.defaultGymJuniorCapacity !== 'number' ||
          typeof nextSettings.hasMultipleClassTotalCapacities !== 'boolean' ||
          typeof nextSettings.hasMultipleClassJuniorCapacities !== 'boolean' ||
          typeof nextSettings.hasMultipleGymCapacities !== 'boolean' ||
          typeof nextSettings.hasMultipleGymJuniorCapacities !== 'boolean' ||
          !Array.isArray(nextSettings.activeTicketTypeIds)
        ) {
          throw new Error('設定データの形式が不正です。');
        }

        if (isActive) {
          // テーブルデータのフェッチ
          const [{ data: sch }, { data: rel }, { data: jp }, { data: gym }] =
            await Promise.all([
              supabase
                .from('performances_schedule')
                .select('id, round_name, start_at, is_active')
                .order('id'),
              supabase
                .from('relationships')
                .select('id, name, is_accepting')
                .order('id'),
              supabase.functions.invoke('admin-auth', {
                body: { action: 'getJuniorPassword' },
                headers: {
                  'x-admin-session-token': token,
                },
              }),
              supabase
                .from('gym_performances')
                .select('group_name')
                .order('group_name'),
            ]);

          if (sch) {
            setSchedules(sch);
          }
          if (rel) {
            setRelationships(rel);
          }
          if (jp && !jp.error) {
            setHasJuniorPassword(jp.hasPassword || false);
          }
          if (gym) {
            setGymClubs([
              ...new Set(
                gym
                  .map((item) => item.group_name)
                  .filter(
                    (name): name is string =>
                      typeof name === 'string' && name.length > 0,
                  ),
              ),
            ]);
          }

          const activeTicketTypeIds = nextSettings.activeTicketTypeIds
            .filter((id: unknown) => typeof id === 'number')
            .map((id: number) => Math.trunc(id));
          const controlsFromApi = nextSettings.ticketIssueModes;
          const nextControls: TicketTypeControls =
            controlsFromApi &&
            typeof controlsFromApi === 'object' &&
            isTicketTypeControlValue(
              (controlsFromApi as Record<string, unknown>).classInvite,
            ) &&
            isTicketTypeControlValue(
              (controlsFromApi as Record<string, unknown>).rehearsalInvite,
            ) &&
            isTicketTypeControlValue(
              (controlsFromApi as Record<string, unknown>).gymInvite,
            ) &&
            isTicketTypeControlValue(
              (controlsFromApi as Record<string, unknown>).entryOnly,
            ) &&
            isTicketTypeControlValue(
              (controlsFromApi as Record<string, unknown>).sameDayClass,
            ) &&
            isTicketTypeControlValue(
              (controlsFromApi as Record<string, unknown>).sameDayGym,
            ) &&
            isTicketTypeControlValue(
              (controlsFromApi as Record<string, unknown>).juniorClass,
            ) &&
            isTicketTypeControlValue(
              (controlsFromApi as Record<string, unknown>).juniorGym,
            ) &&
            isTicketTypeControlValue(
              (controlsFromApi as Record<string, unknown>).juniorEntryOnly,
            )
              ? {
                  classInvite: (
                    controlsFromApi as Record<string, TicketTypeControlValue>
                  ).classInvite,
                  rehearsalInvite: (
                    controlsFromApi as Record<string, TicketTypeControlValue>
                  ).rehearsalInvite,
                  gymInvite: (
                    controlsFromApi as Record<string, TicketTypeControlValue>
                  ).gymInvite,
                  entryOnly: (
                    controlsFromApi as Record<string, TicketTypeControlValue>
                  ).entryOnly,
                  sameDayClass: (
                    controlsFromApi as Record<string, TicketTypeControlValue>
                  ).sameDayClass,
                  sameDayGym: (
                    controlsFromApi as Record<string, TicketTypeControlValue>
                  ).sameDayGym,
                  juniorClass: (
                    controlsFromApi as Record<string, TicketTypeControlValue>
                  ).juniorClass,
                  juniorGym: (
                    controlsFromApi as Record<string, TicketTypeControlValue>
                  ).juniorGym,
                  juniorEntryOnly: (
                    controlsFromApi as Record<string, TicketTypeControlValue>
                  ).juniorEntryOnly,
                }
              : mapActiveIdsToTicketTypeControls(activeTicketTypeIds);
          setSettings({
            ...nextSettings,
            activeTicketTypeIds,
          });
          setTicketTypeControls(nextControls);
        }
      } catch (error) {
        const message = await readErrorMessage(error);
        if (isActive) {
          setSettingsMessageScope('globalSection');
          setSettingsError(`設定の読み込みに失敗しました。${message}`);
        }
      } finally {
        if (isActive) {
          setIsSettingsLoading(false);
        }
      }
    };

    void loadSettings();

    return () => {
      isActive = false;
    };
  }, []);

  const syncSettings = async (
    nextSettings: ControlPanelSettings,
    successMessage = '設定を更新しました。',
    messageScope: Exclude<SettingsMessageScope, null> = 'ticketSection',
    capacitySettingsToUpdate: TicketCapacitySettingKey[] = [],
  ) => {
    const token = getSessionToken();
    if (!token) {
      setSettingsMessageScope(messageScope);
      setSettingsError('セッションがありません。再ログインしてください。');
      return false;
    }

    setSettingsMessageScope(messageScope);
    setSettingsError(null);
    setSettingsSuccess(null);
    setIsSyncingSetting(true);

    try {
      const { data, error } = await supabase.functions.invoke('admin-auth', {
        body: {
          action: 'updateSettings',
          eventYear: nextSettings.eventYear,
          showLength: nextSettings.showLength,
          maxTicketsPerOtherClassUser: nextSettings.maxTicketsPerOtherClassUser,
          maxTicketsPerOtherPerformanceUser:
            nextSettings.maxTicketsPerOtherPerformanceUser,
          classTicketLimitsById: Object.fromEntries(
            nextSettings.classTicketLimits.map((item) => [
              item.id,
              item.max_tickets_per_user,
            ]),
          ),
          maxTicketsPerOtherClubUser: nextSettings.maxTicketsPerOtherClubUser,
          maxOfficialRehearsalTicketsPerUser:
            nextSettings.maxOfficialRehearsalTicketsPerUser,
          showPublicRehearsalDashboard:
            nextSettings.showPublicRehearsalDashboard,
          gymTicketLimitsByClub: nextSettings.gymTicketLimitsByClub,
          maxTicketsPerJuniorUser: nextSettings.maxTicketsPerJuniorUser,
          maxAdmissionOnlyJuniorAccounts:
            nextSettings.maxAdmissionOnlyJuniorAccounts,
          juniorReleaseOpen: nextSettings.juniorReleaseOpen,
          ticketIssuingEnabled: nextSettings.ticketIssuingEnabled,
          maintenanceMode: nextSettings.maintenanceMode,
          maintenanceEndsAt: nextSettings.maintenanceEndsAt,
          defaultClassTotalCapacity: nextSettings.defaultClassTotalCapacity,
          defaultClassJuniorCapacity: nextSettings.defaultClassJuniorCapacity,
          defaultGymCapacity: nextSettings.defaultGymCapacity,
          defaultGymJuniorCapacity: nextSettings.defaultGymJuniorCapacity,
          capacitySettingsToUpdate,
        },
        headers: {
          'x-admin-session-token': token,
        },
      });

      if (error) {
        throw error;
      }

      if (!data?.updated) {
        throw new Error('設定の保存に失敗しました。');
      }

      setSettings({
        ...nextSettings,
        hasMultipleClassTotalCapacities: capacitySettingsToUpdate.includes(
          'defaultClassTotalCapacity',
        )
          ? false
          : nextSettings.hasMultipleClassTotalCapacities,
        hasMultipleClassJuniorCapacities: capacitySettingsToUpdate.includes(
          'defaultClassJuniorCapacity',
        )
          ? false
          : nextSettings.hasMultipleClassJuniorCapacities,
        hasMultipleGymCapacities: capacitySettingsToUpdate.includes(
          'defaultGymCapacity',
        )
          ? false
          : nextSettings.hasMultipleGymCapacities,
        hasMultipleGymJuniorCapacities: capacitySettingsToUpdate.includes(
          'defaultGymJuniorCapacity',
        )
          ? false
          : nextSettings.hasMultipleGymJuniorCapacities,
      });
      setSettingsSuccess(successMessage);
      return true;
    } catch (error) {
      const message = await readErrorMessage(error);
      setSettingsError(`設定の保存に失敗しました。${message}`);
      return false;
    } finally {
      setIsSyncingSetting(false);
    }
  };

  const saveMaintenanceMode = async (
    maintenanceMode: boolean,
    maintenanceEndsAt: string | null,
  ) => {
    setIsModalSubmitting(true);
    const updated = await syncSettings(
      { ...settings, maintenanceMode, maintenanceEndsAt },
      maintenanceMode
        ? 'メンテナンスモードを有効化しました。'
        : 'メンテナンスモードを無効化しました。',
      'ticketSection',
    );
    setIsModalSubmitting(false);
    if (updated && maintenanceMode) {
      setIsMaintenanceEndModalOpen(false);
    }
  };

  const handleToggleTableValue = async (
    table: 'performances_schedule' | 'relationships',
    id: number,
    column: string,
    nextValue: boolean | number,
    messageScope: SettingsMessageScope = 'globalSection',
  ): Promise<boolean> => {
    if (isSettingsLoading || isSyncingSetting) {
      return false;
    }

    const token = getSessionToken();
    if (!token) {
      setSettingsError('セッションがありません。再ログインしてください。');
      return false;
    }

    setSettingsError(null);
    setSettingsSuccess(null);
    setSettingsMessageScope(messageScope);
    setIsSyncingSetting(true);

    try {
      const { error } = await supabase.functions.invoke('admin-auth', {
        body: {
          action: 'updateAcceptingStatus',
          table,
          recordId: id,
          column,
          value: nextValue,
        },
        headers: {
          'x-admin-session-token': token,
        },
      });

      if (error) {
        throw error;
      }

      // ローカルステートの更新
      if (table === 'performances_schedule') {
        setSchedules((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, is_active: nextValue as boolean } : s,
          ),
        );
      } else if (table === 'relationships') {
        setRelationships((prev) =>
          prev.map((r) =>
            r.id === id ? { ...r, is_accepting: nextValue as boolean } : r,
          ),
        );
      }
      setSettingsSuccess('設定を更新しました。');
      return true;
    } catch (error) {
      const message = await readErrorMessage(error);
      setSettingsError(`設定の保存に失敗しました。${message}`);
      return false;
    } finally {
      setIsSyncingSetting(false);
    }
  };

  const syncTicketTypeControls = async (
    nextControls: TicketTypeControls,
    successMessage = '券種別の受付設定を更新しました。',
  ) => {
    const token = getSessionToken();
    if (!token) {
      setSettingsMessageScope('ticketSection');
      setSettingsError('セッションがありません。再ログインしてください。');
      return false;
    }

    const activeTicketTypeIds = buildActiveTicketTypeIds(nextControls);
    const previousActiveTicketTypeIds = settings.activeTicketTypeIds;

    setSettingsMessageScope('ticketSection');
    setSettingsError(null);
    setSettingsSuccess(null);
    setIsSyncingSetting(true);

    setSettings((prev) => ({
      ...prev,
      activeTicketTypeIds,
    }));

    try {
      const { data, error } = await supabase.functions.invoke('admin-auth', {
        body: {
          action: 'updateTicketTypeSettings',
          activeTicketTypeIds,
          ticketIssueModes: {
            classInvite: nextControls.classInvite,
            rehearsalInvite: nextControls.rehearsalInvite,
            gymInvite: nextControls.gymInvite,
            entryOnly: nextControls.entryOnly,
            sameDayClass: nextControls.sameDayClass,
            sameDayGym: nextControls.sameDayGym,
            juniorClass: nextControls.juniorClass,
            juniorGym: nextControls.juniorGym,
            juniorEntryOnly: nextControls.juniorEntryOnly,
          },
        },
        headers: {
          'x-admin-session-token': token,
        },
      });

      if (error) {
        throw error;
      }

      if (!data?.updated) {
        throw new Error('券種別設定の保存に失敗しました。');
      }

      setSettingsSuccess(successMessage);
      return true;
    } catch (error) {
      const message = await readErrorMessage(error);
      setSettingsError(`券種別設定の保存に失敗しました。${message}`);
      setSettings((prev) => ({
        ...prev,
        activeTicketTypeIds: previousActiveTicketTypeIds,
      }));
      return false;
    } finally {
      setIsSyncingSetting(false);
    }
  };

  const openNumericEditModal = (key: NumericSettingKey) => {
    setEditingNumericKey(key);
    setEditingNumericValue(String(settings[key]));
    setSettingsMessageScope('modal');
    setSettingsError(null);
    setSettingsSuccess(null);
  };

  const hasMultipleTicketCapacitySettings = (key: NumericSettingKey) => {
    switch (key) {
      case 'defaultClassTotalCapacity':
        return settings.hasMultipleClassTotalCapacities;
      case 'defaultClassJuniorCapacity':
        return settings.hasMultipleClassJuniorCapacities;
      case 'defaultGymCapacity':
        return settings.hasMultipleGymCapacities;
      case 'defaultGymJuniorCapacity':
        return settings.hasMultipleGymJuniorCapacities;
      default:
        return false;
    }
  };

  const isTicketCapacitySettingKey = (
    key: NumericSettingKey,
  ): key is TicketCapacitySettingKey =>
    key === 'defaultClassTotalCapacity' ||
    key === 'defaultClassJuniorCapacity' ||
    key === 'defaultGymCapacity' ||
    key === 'defaultGymJuniorCapacity';

  const ticketCapacityUpdateWarning = (key: NumericSettingKey) => {
    switch (key) {
      case 'defaultClassTotalCapacity':
        return 'ここで設定すると、すべてのクラス公演の合計チケット数が変更されます。';
      case 'defaultClassJuniorCapacity':
        return 'ここで設定すると、すべてのクラス公演の中学生枠が変更されます。';
      case 'defaultGymCapacity':
        return 'ここで設定すると、すべての体育館公演の合計チケット数が変更されます。';
      case 'defaultGymJuniorCapacity':
        return 'ここで設定すると、すべての体育館公演の中学生枠が変更されます。';
      default:
        return '';
    }
  };

  const openGymClubLimitEditModal = (club: string) => {
    setEditingGymClub(club);
    setEditingGymClubLimit(
      String(
        settings.gymTicketLimitsByClub[club] ??
          settings.maxTicketsPerOtherClubUser,
      ),
    );
    setSettingsMessageScope('modal');
    setSettingsError(null);
    setSettingsSuccess(null);
  };

  const closeGymClubLimitEditModal = () => {
    setEditingGymClub(null);
    setEditingGymClubLimit('');
    setSettingsMessageScope(null);
    setSettingsError(null);
    setSettingsSuccess(null);
  };

  const handleConfirmGymClubLimitEdit = async () => {
    if (!editingGymClub) {
      return;
    }

    const limit = Number(editingGymClubLimit);
    if (!Number.isInteger(limit) || limit < 0 || limit > 100) {
      setSettingsError(
        '部活ごとの発行上限数は0〜100の範囲の整数で入力してください。',
      );
      return;
    }

    const nextSettings = {
      ...settings,
      gymTicketLimitsByClub: {
        ...settings.gymTicketLimitsByClub,
        [editingGymClub]: limit,
      },
    };
    setIsModalSubmitting(true);
    const success = await syncSettings(
      nextSettings,
      `${editingGymClub}の体育館公演チケット発行上限を更新しました。`,
    );
    setIsModalSubmitting(false);
    if (success) {
      closeGymClubLimitEditModal();
    }
  };

  const openClassLimitEditModal = (id: number, limit: number) => {
    setEditingClassLimitId(id);
    setEditingClassLimit(String(limit));
    setSettingsMessageScope('modal');
    setSettingsError(null);
    setSettingsSuccess(null);
  };

  const closeClassLimitEditModal = () => {
    setEditingClassLimitId(null);
    setEditingClassLimit('');
    setSettingsMessageScope(null);
    setSettingsError(null);
    setSettingsSuccess(null);
  };

  const handleConfirmClassLimitEdit = async () => {
    if (editingClassLimitId === null) {
      return;
    }
    const limit = Number(editingClassLimit);
    if (!Number.isInteger(limit) || limit < 0 || limit > 100) {
      setSettingsError(
        'クラスごとの発行可能枚数は0〜100の範囲の整数で入力してください。',
      );
      return;
    }
    const nextSettings = {
      ...settings,
      classTicketLimits: settings.classTicketLimits.map((item) =>
        item.id === editingClassLimitId
          ? { ...item, max_tickets_per_user: limit }
          : item,
      ),
    };
    setIsModalSubmitting(true);
    const className =
      settings.classTicketLimits.find((item) => item.id === editingClassLimitId)
        ?.class_name ?? 'クラス';
    const success = await syncSettings(
      nextSettings,
      `${className}の発行可能枚数を更新しました。`,
    );
    setIsModalSubmitting(false);
    if (success) {
      closeClassLimitEditModal();
    }
  };

  const openBulkClassLimitEditModal = () => {
    setIsBulkClassLimitModalOpen(true);
    setBulkClassLimit('');
    setSettingsMessageScope('modal');
    setSettingsError(null);
    setSettingsSuccess(null);
  };

  const closeBulkClassLimitEditModal = () => {
    setIsBulkClassLimitModalOpen(false);
    setBulkClassLimit('');
    setSettingsMessageScope(null);
    setSettingsError(null);
    setSettingsSuccess(null);
  };

  const handleConfirmBulkClassLimitEdit = async () => {
    const limit = Number(bulkClassLimit);
    if (!Number.isInteger(limit) || limit < 0 || limit > 100) {
      setSettingsError(
        'クラスごとの発行可能枚数は0〜100の範囲の整数で入力してください。',
      );
      return;
    }

    const nextSettings = {
      ...settings,
      classTicketLimits: settings.classTicketLimits.map((item) => ({
        ...item,
        max_tickets_per_user: limit,
      })),
    };
    setIsModalSubmitting(true);
    const success = await syncSettings(
      nextSettings,
      '全クラスの発行可能枚数を一括更新しました。',
    );
    setIsModalSubmitting(false);
    if (success) {
      closeBulkClassLimitEditModal();
    }
  };

  const openScheduleEditModal = (schedule: (typeof schedules)[number]) => {
    setEditingSchedule({
      id: schedule.id,
      roundName: schedule.round_name,
      startAt: toLocalDateTimeInputValue(schedule.start_at),
      isActive: schedule.is_active,
    });
    setSettingsMessageScope('modal');
    setSettingsError(null);
    setSettingsSuccess(null);
  };

  const closeScheduleEditModal = () => {
    setEditingSchedule(null);
    setSettingsMessageScope(null);
    setSettingsError(null);
    setSettingsSuccess(null);
  };

  const handleConfirmScheduleEdit = async () => {
    if (!editingSchedule) {
      return;
    }
    if (!editingSchedule.roundName.trim()) {
      setSettingsError('公演回名を入力してください。');
      return;
    }
    if (
      !editingSchedule.startAt ||
      Number.isNaN(Date.parse(editingSchedule.startAt))
    ) {
      setSettingsError('開始時刻を正しく入力してください。');
      return;
    }

    setIsModalSubmitting(true);
    try {
      const token = getSessionToken();
      if (!token) {
        throw new Error('セッションがありません。再ログインしてください。');
      }
      const { data, error } = await supabase.functions.invoke('admin-auth', {
        body: {
          action: 'updatePerformanceSchedule',
          recordId: editingSchedule.id,
          roundName: editingSchedule.roundName,
          startAt: new Date(editingSchedule.startAt).toISOString(),
          isActive: editingSchedule.isActive,
        },
        headers: { 'x-admin-session-token': token },
      });
      if (error) {
        throw error;
      }
      if (!data?.updated || !data.schedule) {
        throw new Error('公演回の保存に失敗しました。');
      }
      setSchedules((current) =>
        current.map((schedule) =>
          schedule.id === editingSchedule.id ? data.schedule : schedule,
        ),
      );
      closeScheduleEditModal();
      setSettingsMessageScope('detailSection');
      if (data.redeployError) {
        setSettingsError(
          `公演回を更新しましたが、再デプロイの開始に失敗しました。手動で再デプロイしてください。${data.redeployError}`,
        );
      } else {
        setSettingsSuccess(
          data.redeployTriggered
            ? '公演回を更新し、再デプロイを開始しました。反映まで数分かかる場合があります。'
            : '公演回を更新しました。',
        );
      }
    } catch (error) {
      const message = await readErrorMessage(error);
      setSettingsError(`公演回の保存に失敗しました。${message}`);
    } finally {
      setIsModalSubmitting(false);
    }
  };

  const closeNumericEditModal = () => {
    setEditingNumericKey(null);
    setEditingNumericValue('');
    setSettingsMessageScope(null);
    setSettingsError(null);
    setSettingsSuccess(null);
  };

  const handleConfirmNumericEdit = async () => {
    if (!editingNumericKey) {
      return;
    }

    const key = editingNumericKey;
    const meta = NUMERIC_SETTING_META[key];
    const parsed = Number(editingNumericValue);
    if (!Number.isInteger(parsed) || parsed < meta.min || parsed > meta.max) {
      setSettingsError(
        `${meta.label}は${meta.min}〜${meta.max}の範囲の整数で入力してください。`,
      );
      return;
    }

    // 全体デフォルト設定：中学生枠と合計定員の整合性チェック
    if (
      key === 'defaultClassTotalCapacity' &&
      parsed < settings.defaultClassJuniorCapacity
    ) {
      setSettingsError(
        '合計定員のデフォルト値は現在の中学生枠のデフォルト値より少なく設定できません。',
      );
      return;
    }
    if (
      key === 'defaultClassJuniorCapacity' &&
      parsed > settings.defaultClassTotalCapacity
    ) {
      setSettingsError(
        '中学生枠のデフォルト値は現在の合計定員のデフォルト値より多く設定できません。',
      );
      return;
    }
    if (
      key === 'defaultGymJuniorCapacity' &&
      parsed > settings.defaultGymCapacity
    ) {
      setSettingsError(
        '中学生枠のデフォルト値は現在の体育館公演定員より多く設定できません。',
      );
      return;
    }
    if (
      key === 'defaultGymCapacity' &&
      parsed < settings.defaultGymJuniorCapacity
    ) {
      setSettingsError(
        '体育館公演定員は現在の中学生枠のデフォルト値より少なく設定できません。',
      );
      return;
    }
    setIsModalSubmitting(true);
    const nextSettings = { ...settings, [key]: parsed };
    const success = await syncSettings(
      nextSettings,
      `${meta.label}を更新しました。`,
      key === 'eventYear' || key === 'showLength'
        ? 'globalSection'
        : 'ticketSection',
      isTicketCapacitySettingKey(key) ? [key] : [],
    );
    setIsModalSubmitting(false);
    if (success) {
      closeNumericEditModal();
    }
  };

  const handleTicketTypeControlChange = (
    key: TicketTypeControlKey,
    nextValue: TicketTypeControlValue,
  ) => {
    if (isSettingsLoading || isSyncingSetting) {
      return;
    }

    const previousControls = ticketTypeControls;
    const nextControls: TicketTypeControls = {
      ...previousControls,
      [key]: nextValue,
    };
    setTicketTypeControls(nextControls);

    const labelByKey: Record<TicketTypeControlKey, string> = {
      classInvite: '招待券(クラス公演)受付',
      rehearsalInvite: '招待券(リハーサル)受付',
      gymInvite: '招待券(体育館公演)受付',
      entryOnly: '招待券(入場専用券)受付',
      sameDayClass: '当日券(クラス公演)受付',
      sameDayGym: '当日券(体育館公演)受付',
      juniorClass: '中学生券(クラス公演)受付',
      juniorGym: '中学生券(体育館公演)受付',
      juniorEntryOnly: '中学生券(入場専用券)受付',
    };

    void syncTicketTypeControls(
      nextControls,
      `${labelByKey[key]}を更新しました。`,
    ).then((updated) => {
      if (!updated) {
        setTicketTypeControls(previousControls);
      }
    });
  };

  const handleJuniorPasswordUpdate = async (event: Event) => {
    event.preventDefault();
    setJuniorPasswordError(null);
    setJuniorPasswordSuccess(null);

    if (juniorPassword.length < 4) {
      setJuniorPasswordError('合言葉は4文字以上で入力してください。');
      return;
    }

    if (juniorPassword !== juniorPasswordConfirm) {
      setJuniorPasswordError('合言葉と確認用合言葉が一致しません。');
      return;
    }

    setIsUpdatingJuniorPassword(true);

    try {
      const token = getSessionToken();
      if (!token) {
        throw new Error('セッションがありません。再ログインしてください。');
      }

      const { data, error } = await supabase.functions.invoke('admin-auth', {
        body: {
          action: 'updateJuniorPassword',
          juniorPassword,
        },
        headers: {
          'x-admin-session-token': token,
        },
      });

      if (error) {
        throw error;
      }

      if (!data?.updated) {
        throw new Error('合言葉の更新に失敗しました。');
      }

      setJuniorPassword('');
      setJuniorPasswordConfirm('');
      setHasJuniorPassword(true);
      setJuniorPasswordSuccess('合言葉を更新しました。');
    } catch (error) {
      const message = await readErrorMessage(error);
      setJuniorPasswordError(`合言葉の更新に失敗しました。${message}`);
    } finally {
      setIsUpdatingJuniorPassword(false);
    }
  };

  const handleRedeploy = async () => {
    setIsRedeploying(true);
    setSettingsMessageScope('globalSection');
    setSettingsError(null);
    setSettingsSuccess(null);
    try {
      const { data, error } = await supabase.functions.invoke('admin-auth', {
        body: { action: 'triggerRedeploy' },
        headers: { 'x-admin-session-token': getSessionToken() ?? '' },
      });
      if (error || !data?.redeployTriggered) {
        throw error ?? new Error('再デプロイを開始できませんでした。');
      }
      setSettingsSuccess(
        '再デプロイを開始しました。反映まで数分かかる場合があります。',
      );
    } catch (error) {
      setSettingsError(
        `再デプロイの開始に失敗しました。${await readErrorMessage(error)}`,
      );
    } finally {
      setIsRedeploying(false);
    }
  };

  return (
    <div>
      {!isSettingsLoading && settings.eventYear !== config.year && (
        <Alert type='error'>
          <p>
            Supabase側の設定年度 ({settings.eventYear}) と、 config.yamlの年度 (
            {config.year}) が一致していません。
            不具合の原因となるため、忘れずにconfig.yamlの年度を更新してください。
          </p>
        </Alert>
      )}
      <Alert type='warning'>
        <p>
          このページはシステム全体に影響を与えます。設定変更には十分ご注意ください。
        </p>
      </Alert>
      <NormalSection>
        <div className={styles.headerRow}>
          <div>
            <h2>ステータス</h2>
            <p className={styles.settingHint}>
              初回登録率・発券数・ランキングを確認できます。
            </p>
          </div>
          <a className={styles.inlineEditButton} href='/admin/status'>
            ステータス画面を開く
          </a>
        </div>
      </NormalSection>
      <NormalSection>
        <h2>全体</h2>
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <div className={styles.settingLabelGroup}>
              <label
                className={styles.settingLabel}
                htmlFor='settings-event-year'
              >
                年度
              </label>
              <p className={styles.settingHint}>
                ここでの変更はチケットの年度情報のみ適用されます
              </p>
            </div>
            <div className={styles.settingControlGroup}>
              <span id='settings-event-year' className={styles.fieldValue}>
                {settings.eventYear}
              </span>
              <button
                type='button'
                className={styles.inlineEditButton}
                onClick={() => openNumericEditModal('eventYear')}
                disabled={isSettingsLoading || isSyncingSetting}
              >
                変更する
              </button>
            </div>
          </div>
          <div className={styles.field}>
            <label
              className={styles.settingLabel}
              htmlFor='settings-show-length-minutes'
            >
              1公演の長さ（分）
            </label>
            <div className={styles.settingControlGroup}>
              <span
                id='settings-show-length-minutes'
                className={styles.fieldValue}
              >
                {settings.showLength}
              </span>
              <button
                type='button'
                className={styles.inlineEditButton}
                onClick={() => openNumericEditModal('showLength')}
                disabled={isSettingsLoading || isSyncingSetting}
              >
                変更する
              </button>
            </div>
          </div>
        </div>
        {settingsMessageScope === 'globalSection' && isSettingsLoading && (
          <LoadingSpinner message='設定を読み込み中です...' />
        )}
        {settingsMessageScope === 'globalSection' && settingsError && (
          <p className={styles.authError}>{settingsError}</p>
        )}
        {settingsMessageScope === 'globalSection' && settingsSuccess && (
          <p className={styles.authSuccess}>{settingsSuccess}</p>
        )}
      </NormalSection>

      <NormalSection>
        <h2>サイトの再デプロイ</h2>
        <p className={styles.noteText}>
          公演情報など、ビルド時に生成されるサイト内容を最新の状態に反映します。
        </p>
        <button
          type='button'
          className={styles.inlineEditButton}
          onClick={handleRedeploy}
          disabled={isRedeploying}
        >
          {isRedeploying ? '再デプロイを開始中…' : '再デプロイする'}
        </button>
      </NormalSection>

      <NormalSection>
        <h2>チケット管理</h2>
        <p className={styles.noteText}>
          発券済みチケットの検索、状態確認、取消、チケットページへの移動を行えます。
        </p>
        <a className={styles.linkButton} href='/admin/tickets'>
          チケット管理を開く
        </a>
      </NormalSection>

      <NormalSection>
        <h2>公演情報を変更</h2>
        <p className={styles.noteText}>
          クラス・体育館・展示公演の情報、定員、受付状態を一覧から編集できます。保存時の年度は設定中の年度に自動同期されます。
        </p>
        <a className={styles.linkButton} href='/admin/performances-management'>
          公演情報を変更
        </a>
      </NormalSection>

      <NormalSection>
        <h2>生徒アカウント管理</h2>
        <p className={styles.noteText}>
          学年・クラス・出席番号の全組み合わせに対するログインアカウントを一括生成し、Authへ登録します。
        </p>
        <a href='/admin/student-accounts' className={styles.linkButton}>
          こちらで変更
        </a>
      </NormalSection>

      <NormalSection>
        <h2>中学生アカウント管理</h2>
        <p className={styles.noteText}>
          csvファイルから、中学生アカウントのIDとパスワードを一括でAuthへ登録します。
        </p>
        <a href='/admin/junior-accounts' className={styles.linkButton}>
          こちらで変更
        </a>
      </NormalSection>

      <NormalSection>
        <h2>中学生用合言葉設定</h2>
        <p className={styles.noteText}>
          中学生アカウント登録時に必要な合言葉を設定します。
        </p>
        <form
          className={styles.passwordForm}
          onSubmit={handleJuniorPasswordUpdate}
        >
          <div className={styles.juniorPasswordStatusContainer}>
            <label className={styles.authLabel}>現在の合言葉設定</label>
            <p
              className={`${styles.juniorPasswordStatus} ${
                hasJuniorPassword
                  ? styles.juniorPasswordStatusSet
                  : styles.juniorPasswordStatusUnset
              }`}
            >
              {hasJuniorPassword ? '設定済み' : '未設定'}
            </p>
          </div>
          <label className={styles.authLabel} htmlFor='junior-password'>
            新しい合言葉
          </label>
          <input
            id='junior-password'
            type='text'
            className={styles.authInput}
            value={juniorPassword}
            onInput={(event) =>
              setJuniorPassword((event.target as HTMLInputElement).value)
            }
            placeholder='4文字以上の合言葉'
            minLength={4}
            required
          />
          <label className={styles.authLabel} htmlFor='junior-password-confirm'>
            新しい合言葉（確認）
          </label>
          <input
            id='junior-password-confirm'
            type='text'
            className={styles.authInput}
            value={juniorPasswordConfirm}
            onInput={(event) =>
              setJuniorPasswordConfirm((event.target as HTMLInputElement).value)
            }
            placeholder='同じ合言葉を再度入力'
            minLength={4}
            required
          />
          {juniorPasswordError && (
            <p className={styles.authError}>{juniorPasswordError}</p>
          )}
          {juniorPasswordSuccess && (
            <p className={styles.authSuccess}>{juniorPasswordSuccess}</p>
          )}
          <button
            type='submit'
            className={styles.authButton}
            disabled={isUpdatingJuniorPassword}
          >
            {isUpdatingJuniorPassword ? '変更中...' : '合言葉を変更'}
          </button>
        </form>
      </NormalSection>

      <NormalSection>
        <h2>クラス・部活管理者</h2>
        <p className={styles.noteText}>
          団体管理者アカウントの一括作成・一覧・ID・パスワード変更を行います。
        </p>
        <a className={styles.linkButton} href='/admin/organization-accounts'>
          管理者アカウントを開く
        </a>
      </NormalSection>

      <NormalSection>
        <div className={styles.headerRow}>
          <div>
            <h2>公開リハーサル</h2>
            <p className={styles.settingHint}>
              総務が公開リハの作成・編集・中止を管理します。
            </p>
          </div>
          <a
            className={styles.inlineEditButton}
            href='/admin/public-rehearsals'
          >
            公開リハを管理
          </a>
        </div>
      </NormalSection>

      <NormalSection>
        <h2>チケット発券</h2>
        <div className={styles.formGrid}>
          <div>
            <h3>全体</h3>
            <div className={styles.field}>
              <label className={styles.settingLabel}>チケット発券全体</label>
              <label>
                <Switch
                  id='ticket-issuing-enabled'
                  onChange={(checked: boolean) => {
                    if (isSettingsLoading || isSyncingSetting) {
                      return;
                    }

                    setSettings((prev) => {
                      const next = { ...prev, ticketIssuingEnabled: checked };
                      void syncSettings(
                        next,
                        checked
                          ? 'チケット発券を有効化しました。'
                          : 'チケット発券を停止しました。',
                        'ticketSection',
                      ).then((updated) => {
                        if (!updated) {
                          setSettings((current) => ({
                            ...current,
                            ticketIssuingEnabled: prev.ticketIssuingEnabled,
                          }));
                        }
                      });
                      return next;
                    });
                  }}
                  checked={settings.ticketIssuingEnabled}
                />
              </label>
            </div>
            <div className={styles.field}>
              <label className={styles.settingLabel}>
                ダッシュボードに公開リハ表を表示
              </label>
              <label>
                <Switch
                  checked={settings.showPublicRehearsalDashboard}
                  onChange={(checked) => {
                    if (isSettingsLoading || isSyncingSetting) {
                      return;
                    }
                    void syncSettings(
                      { ...settings, showPublicRehearsalDashboard: checked },
                      checked
                        ? 'ダッシュボードの公開リハ表を表示しました。'
                        : 'ダッシュボードの公開リハ表を非表示にしました。',
                      'ticketSection',
                    );
                  }}
                />
              </label>
            </div>
            <h3>メンテナスモード</h3>
            <div className={styles.field}>
              <label className={styles.settingLabel} htmlFor='maintenance-mode'>
                メンテナンスモードを有効にする
              </label>
              <Switch
                id='maintenance-mode'
                checked={settings.maintenanceMode}
                onChange={(checked: boolean) => {
                  if (isSettingsLoading || isSyncingSetting) {
                    return;
                  }
                  if (checked) {
                    setMaintenanceEndsAtDraft(
                      settings.maintenanceEndsAt
                        ? toLocalDateTimeInputValue(settings.maintenanceEndsAt)
                        : '',
                    );
                    setIsMaintenanceEndModalOpen(true);
                    return;
                  }
                  void saveMaintenanceMode(false, null);
                }}
              />
            </div>
            {settings.maintenanceMode && (
              <div className={styles.field}>
                <label
                  className={styles.settingLabel}
                  htmlFor='maintenance-ends-at'
                >
                  終了予定日時
                </label>
                <input
                  id='maintenance-ends-at'
                  className={styles.fieldControl}
                  type='datetime-local'
                  value={
                    settings.maintenanceEndsAt
                      ? toLocalDateTimeInputValue(settings.maintenanceEndsAt)
                      : ''
                  }
                  onInput={(event) => {
                    const value = (event.target as HTMLInputElement).value;
                    setSettings((current) => ({
                      ...current,
                      maintenanceEndsAt: value
                        ? new Date(value).toISOString()
                        : null,
                    }));
                  }}
                  onBlur={(event) => {
                    if (event.currentTarget.value) {
                      void saveMaintenanceMode(
                        true,
                        new Date(event.currentTarget.value).toISOString(),
                      );
                    }
                  }}
                  disabled={isSettingsLoading || isSyncingSetting}
                  required
                />
              </div>
            )}
            <h3>券種別の受付設定</h3>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-class-invite'
              >
                招待券(クラス公演)受付
              </label>
              <select
                id='ticket-class-invite'
                className={styles.fieldControl}
                value={ticketTypeControls.classInvite}
                onChange={(event) =>
                  handleTicketTypeControlChange(
                    'classInvite',
                    (event.target as HTMLSelectElement)
                      .value as TicketTypeControlValue,
                  )
                }
                disabled={isSettingsLoading || isSyncingSetting}
              >
                <option value='open'>すべて</option>
                <option value='only-own'>自クラスのみ</option>
                <option value='outside-own-self-only'>
                  他クラスは間柄「本人」のみ
                </option>
                <option value='off'>無効</option>
              </select>
            </div>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-rehearsal-invite'
              >
                招待券(リハーサル)受付
              </label>
              <select
                id='ticket-rehearsal-invite'
                className={styles.fieldControl}
                value={ticketTypeControls.rehearsalInvite}
                onChange={(event) =>
                  handleTicketTypeControlChange(
                    'rehearsalInvite',
                    (event.target as HTMLSelectElement)
                      .value as TicketTypeControlValue,
                  )
                }
                disabled={isSettingsLoading || isSyncingSetting}
              >
                <option value='open'>すべて</option>
                <option value='public-rehearsals'>公開リハーサルのみ</option>
                <option value='self-rehearsals'>自主リハーサルのみ</option>
                <option value='off'>無効</option>
              </select>
            </div>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-gym-invite'
              >
                招待券(体育館公演)受付
              </label>
              <select
                id='ticket-gym-invite'
                className={styles.fieldControl}
                value={ticketTypeControls.gymInvite}
                onChange={(event) =>
                  handleTicketTypeControlChange(
                    'gymInvite',
                    (event.target as HTMLSelectElement)
                      .value as TicketTypeControlValue,
                  )
                }
                disabled={isSettingsLoading || isSyncingSetting}
              >
                <option value='open'>すべて</option>
                <option value='only-own'>自部活のみ</option>
                <option value='outside-own-self-only'>
                  他部活は間柄「本人」のみ
                </option>
                <option value='off'>無効</option>
              </select>
            </div>
            <div className={styles.field}>
              <span className={styles.settingLabel}>
                招待券(入場専用券)受付
              </span>
              <label>
                <Switch
                  id='ticket-entry-only'
                  checked={ticketTypeControls.entryOnly === 'open'}
                  onChange={(checked) =>
                    handleTicketTypeControlChange(
                      'entryOnly',
                      checked ? 'open' : 'off',
                    )
                  }
                ></Switch>
              </label>
            </div>

            <div className={styles.field}>
              <label className={styles.settingLabel}>
                中学生券(クラス公演)受付
              </label>
              <label>
                <Switch
                  checked={ticketTypeControls.juniorClass === 'open'}
                  onChange={(checked) =>
                    handleTicketTypeControlChange(
                      'juniorClass',
                      checked ? 'open' : 'off',
                    )
                  }
                />
              </label>
            </div>
            <div className={styles.field}>
              <label className={styles.settingLabel}>
                中学生券(体育館公演)受付
              </label>
              <label>
                <Switch
                  checked={ticketTypeControls.juniorGym === 'open'}
                  onChange={(checked) =>
                    handleTicketTypeControlChange(
                      'juniorGym',
                      checked ? 'open' : 'off',
                    )
                  }
                />
              </label>
            </div>
            <div className={styles.field}>
              <label className={styles.settingLabel}>
                中学生券(入場専用)受付
              </label>
              <label>
                <Switch
                  checked={ticketTypeControls.juniorEntryOnly === 'open'}
                  onChange={(checked) =>
                    handleTicketTypeControlChange(
                      'juniorEntryOnly',
                      checked ? 'open' : 'off',
                    )
                  }
                />
              </label>
            </div>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-same-day-class'
              >
                当日券(クラス公演)受付
              </label>
              <select
                id='ticket-same-day-class'
                className={styles.fieldControl}
                value={ticketTypeControls.sameDayClass}
                onChange={(event) =>
                  handleTicketTypeControlChange(
                    'sameDayClass',
                    (event.target as HTMLSelectElement)
                      .value as TicketTypeControlValue,
                  )
                }
                disabled={isSettingsLoading || isSyncingSetting}
              >
                <option value='open'>有効</option>
                <option value='auto'>当日のみ</option>
                <option value='off'>無効</option>
              </select>
            </div>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-same-day-gym'
              >
                当日券(体育館公演)受付
              </label>
              <select
                id='ticket-same-day-gym'
                className={styles.fieldControl}
                value={ticketTypeControls.sameDayGym}
                onChange={(event) =>
                  handleTicketTypeControlChange(
                    'sameDayGym',
                    (event.target as HTMLSelectElement)
                      .value as TicketTypeControlValue,
                  )
                }
                disabled={isSettingsLoading || isSyncingSetting}
              >
                <option value='open'>有効</option>
                <option value='auto'>当日のみ</option>
                <option value='off'>無効</option>
              </select>
            </div>
          </div>
          <div>
            <h3>チケット数の受付設定</h3>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-class-total'
              >
                クラス公演の1公演あたりのチケット数(中学生券含む)
              </label>
              <div className={styles.settingControlGroup}>
                <span id='ticket-class-total' className={styles.fieldValue}>
                  {settings.hasMultipleClassTotalCapacities
                    ? '各設定参照'
                    : settings.defaultClassTotalCapacity}
                </span>
                <button
                  type='button'
                  className={styles.inlineEditButton}
                  onClick={() =>
                    openNumericEditModal('defaultClassTotalCapacity')
                  }
                  disabled={isSettingsLoading || isSyncingSetting}
                >
                  変更する
                </button>
              </div>
            </div>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-class-junior'
              >
                クラス公演の1公演あたり中学生枠
              </label>
              <div className={styles.settingControlGroup}>
                <span id='ticket-class-junior' className={styles.fieldValue}>
                  {settings.hasMultipleClassJuniorCapacities
                    ? '各設定参照'
                    : settings.defaultClassJuniorCapacity}
                </span>
                <button
                  type='button'
                  className={styles.inlineEditButton}
                  onClick={() =>
                    openNumericEditModal('defaultClassJuniorCapacity')
                  }
                  disabled={isSettingsLoading || isSyncingSetting}
                >
                  変更する
                </button>
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.settingLabel} htmlFor='ticket-gym-total'>
                体育館公演の1公演あたりのチケット数(中学生券含む)
              </label>
              <div className={styles.settingControlGroup}>
                <span id='ticket-gym-total' className={styles.fieldValue}>
                  {settings.hasMultipleGymCapacities
                    ? '各設定参照'
                    : settings.defaultGymCapacity}
                </span>
                <button
                  type='button'
                  className={styles.inlineEditButton}
                  onClick={() => openNumericEditModal('defaultGymCapacity')}
                  disabled={isSettingsLoading || isSyncingSetting}
                >
                  変更する
                </button>
              </div>
            </div>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-gym-junior'
              >
                体育館公演の1公演あたり中学生枠
              </label>
              <div className={styles.settingControlGroup}>
                <span id='ticket-gym-junior' className={styles.fieldValue}>
                  {settings.hasMultipleGymJuniorCapacities
                    ? '各設定参照'
                    : settings.defaultGymJuniorCapacity}
                </span>
                <button
                  type='button'
                  className={styles.inlineEditButton}
                  onClick={() =>
                    openNumericEditModal('defaultGymJuniorCapacity')
                  }
                  disabled={isSettingsLoading || isSyncingSetting}
                >
                  変更する
                </button>
              </div>
            </div>
          </div>
          <div>
            <h3>部活ごとの発行上限数</h3>
            {gymClubs.length > 0 ? (
              <div>
                <p className={styles.settingHint}>
                  未設定の場合は他部活共通上限（
                  {settings.maxTicketsPerOtherClubUser}
                  枚）を使用します。複数の部活に所属する生徒は、所属部活分を合算します。
                </p>
                {gymClubs.map((club) => (
                  <div key={club} className={styles.field}>
                    <label
                      className={styles.settingLabel}
                      htmlFor={`ticket-limit-${club}`}
                    >
                      {club}
                    </label>
                    <div className={styles.settingControlGroup}>
                      <span
                        id={`ticket-limit-${club}`}
                        className={styles.fieldValue}
                      >
                        {settings.gymTicketLimitsByClub[club] ??
                          settings.maxTicketsPerOtherClubUser}
                      </span>
                      <button
                        type='button'
                        className={styles.inlineEditButton}
                        onClick={() => openGymClubLimitEditModal(club)}
                        disabled={isSettingsLoading || isSyncingSetting}
                      >
                        変更する
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.settingHint}>
                体育館公演を登録すると、部活別上限を設定できます。
              </p>
            )}
          </div>
          <div>
            <div className={styles.settingHeadingRow}>
              <div>
                <h3>クラスごとの発行可能枚数</h3>
                <p className={styles.settingHint}>
                  各クラスの生徒が自クラス公演を発行できる枚数です。
                </p>
              </div>
              <button
                type='button'
                disabled={isSettingsLoading || isSyncingSetting}
                onClick={openBulkClassLimitEditModal}
              >
                全クラスを一括変更
              </button>
            </div>
            {settings.classTicketLimits.map((item) => (
              <div className={styles.field} key={item.id}>
                <label
                  className={styles.settingLabel}
                  htmlFor={`class-ticket-limit-${item.id}`}
                >
                  {item.class_name}
                </label>
                <div className={styles.settingControlGroup}>
                  <span
                    id={`class-ticket-limit-${item.id}`}
                    className={styles.fieldValue}
                  >
                    {item.max_tickets_per_user}
                  </span>
                  <button
                    type='button'
                    className={styles.inlineEditButton}
                    onClick={() =>
                      openClassLimitEditModal(
                        item.id,
                        item.max_tickets_per_user,
                      )
                    }
                    disabled={isSettingsLoading || isSyncingSetting}
                  >
                    変更する
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div>
            <h3>1人あたりのチケット発行上限</h3>

            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-max-per-other-performance-user'
              >
                他クラス・部活の合計発行可能枚数
              </label>
              <div className={styles.settingControlGroup}>
                <span
                  id='ticket-max-per-other-performance-user'
                  className={styles.fieldValue}
                >
                  {settings.maxTicketsPerOtherPerformanceUser}
                </span>
                <button
                  type='button'
                  className={styles.inlineEditButton}
                  onClick={() =>
                    openNumericEditModal('maxTicketsPerOtherPerformanceUser')
                  }
                  disabled={isSettingsLoading || isSyncingSetting}
                >
                  変更する
                </button>
              </div>
            </div>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-max-per-other-class-user'
              >
                他クラスの1クラスあたりの発行可能枚数
              </label>
              <div className={styles.settingControlGroup}>
                <span
                  id='ticket-max-per-other-class-user'
                  className={styles.fieldValue}
                >
                  {settings.maxTicketsPerOtherClassUser}
                </span>
                <button
                  type='button'
                  className={styles.inlineEditButton}
                  onClick={() =>
                    openNumericEditModal('maxTicketsPerOtherClassUser')
                  }
                  disabled={isSettingsLoading || isSyncingSetting}
                >
                  変更する
                </button>
              </div>
            </div>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-max-per-gym-user'
              >
                他部活の1部活あたり発行上限
              </label>
              <div className={styles.settingControlGroup}>
                <span
                  id='ticket-max-per-gym-user'
                  className={styles.fieldValue}
                >
                  {settings.maxTicketsPerOtherClubUser}
                </span>
                <button
                  type='button'
                  className={styles.inlineEditButton}
                  onClick={() =>
                    openNumericEditModal('maxTicketsPerOtherClubUser')
                  }
                  disabled={isSettingsLoading || isSyncingSetting}
                >
                  変更する
                </button>
              </div>
            </div>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-junior-max-per-user'
              >
                中学生のチケット発行上限
              </label>
              <div className={styles.settingControlGroup}>
                <span
                  id='ticket-junior-max-per-user'
                  className={styles.fieldValue}
                >
                  {settings.maxTicketsPerJuniorUser}
                </span>
                <button
                  type='button'
                  className={styles.inlineEditButton}
                  onClick={() =>
                    openNumericEditModal('maxTicketsPerJuniorUser')
                  }
                  disabled={isSettingsLoading || isSyncingSetting}
                >
                  変更する
                </button>
              </div>
            </div>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-public-rehearsal-max-per-user'
              >
                公開リハの生徒1人あたり発行上限
              </label>
              <div className={styles.settingControlGroup}>
                <span
                  id='ticket-public-rehearsal-max-per-user'
                  className={styles.fieldValue}
                >
                  {settings.maxOfficialRehearsalTicketsPerUser}
                </span>
                <button
                  type='button'
                  className={styles.inlineEditButton}
                  onClick={() =>
                    openNumericEditModal('maxOfficialRehearsalTicketsPerUser')
                  }
                  disabled={isSettingsLoading || isSyncingSetting}
                >
                  変更する
                </button>
              </div>
            </div>
          </div>
          <div>
            <h3>その他設定</h3>
            <div className={styles.field}>
              <label className={styles.settingLabel}>中学生枠の一般解放</label>
              <label>
                <Switch
                  id='ticket-junior-release'
                  onChange={(checked: boolean) => {
                    if (isSettingsLoading || isSyncingSetting) {
                      return;
                    }

                    setSettings((prev) => {
                      const next = { ...prev, juniorReleaseOpen: checked };
                      // 非同期通信をバックグラウンドで実行
                      void syncSettings(
                        next,
                        '中学生枠の一般解放設定を更新しました。',
                        'ticketSection',
                      ).then((updated) => {
                        // 失敗した場合は以前の値を参照して戻す
                        if (!updated) {
                          setSettings((current) => ({
                            ...current,
                            juniorReleaseOpen: prev.juniorReleaseOpen,
                          }));
                        }
                      });
                      return next;
                    });
                  }}
                  checked={settings.juniorReleaseOpen}
                />
              </label>
            </div>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-admission-only-max-junior'
              >
                入場専用券のみ登録可能な中学生アカウント上限
              </label>
              <div className={styles.settingControlGroup}>
                <span
                  id='ticket-admission-only-max-junior'
                  className={styles.fieldValue}
                >
                  {settings.maxAdmissionOnlyJuniorAccounts}
                </span>
                <button
                  type='button'
                  className={styles.inlineEditButton}
                  onClick={() =>
                    openNumericEditModal('maxAdmissionOnlyJuniorAccounts')
                  }
                  disabled={isSettingsLoading || isSyncingSetting}
                >
                  変更する
                </button>
              </div>
            </div>
          </div>
        </div>
        {settingsMessageScope === 'ticketSection' && isSettingsLoading && (
          <LoadingSpinner message='設定を読み込み中です...' />
        )}
        {settingsMessageScope === 'ticketSection' && settingsError && (
          <p className={styles.authError}>{settingsError}</p>
        )}
        {settingsMessageScope === 'ticketSection' && settingsSuccess && (
          <p className={styles.authSuccess}>{settingsSuccess}</p>
        )}
      </NormalSection>
      <NormalSection>
        <h2>詳細な受付・有効設定</h2>
        <div className={styles.tabList} role='tablist'>
          <button
            type='button'
            role='tab'
            className={`${styles.tabButton} ${activeDetailTab === 'schedules' ? styles.tabButtonActive : ''}`}
            aria-selected={activeDetailTab === 'schedules'}
            onClick={() => setActiveDetailTab('schedules')}
          >
            公演回
          </button>
          <button
            type='button'
            role='tab'
            className={`${styles.tabButton} ${activeDetailTab === 'relationships' ? styles.tabButtonActive : ''}`}
            aria-selected={activeDetailTab === 'relationships'}
            onClick={() => setActiveDetailTab('relationships')}
          >
            間柄
          </button>
        </div>

        <div className={styles.tabContent}>
          {activeDetailTab === 'schedules' && (
            <div className={styles.toggleList}>
              <h3>公演回の設定</h3>
              {schedules.map((s) => (
                <div key={`sch-${s.id}`} className={styles.field}>
                  <span className={styles.settingLabel}>
                    {s.round_name}
                    <span className={styles.settingTimeLabel}>
                      {new Date(s.start_at).toLocaleString('ja-JP')}〜
                    </span>
                  </span>
                  <div className={styles.settingControlGroup}>
                    <button
                      type='button'
                      className={styles.inlineEditButton}
                      onClick={() => openScheduleEditModal(s)}
                    >
                      編集
                    </button>
                    <label>
                      <Switch
                        checked={s.is_active}
                        onChange={(val) =>
                          handleToggleTableValue(
                            'performances_schedule',
                            s.id,
                            'is_active',
                            val,
                            'detailSection',
                          )
                        }
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeDetailTab === 'relationships' && (
            <div className={styles.toggleList}>
              <h3>間柄の受付</h3>
              {relationships.map((r) => (
                <div key={`rel-${r.id}`} className={styles.field}>
                  <span className={styles.settingLabel}>{r.name}</span>
                  <label>
                    <Switch
                      checked={r.is_accepting}
                      onChange={(val) =>
                        handleToggleTableValue(
                          'relationships',
                          r.id,
                          'is_accepting',
                          val,
                          'detailSection',
                        )
                      }
                    />
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>
        {settingsMessageScope === 'detailSection' && isSyncingSetting && (
          <p className={styles.statusMessage}>設定を更新中です...</p>
        )}
        {settingsMessageScope === 'detailSection' && settingsError && (
          <p className={styles.authError}>{settingsError}</p>
        )}
        {settingsMessageScope === 'detailSection' && settingsSuccess && (
          <p className={styles.authSuccess}>{settingsSuccess}</p>
        )}
      </NormalSection>
      <NormalSection>
        <h2>削除ツール</h2>
        <p className={styles.noteText}>
          データの削除は慎重に行う必要があります。削除を行う前に、必ずデータのバックアップを取ってください。
        </p>
        <div className={styles.deleteButtonContainer}>
          <h3>チケットの削除</h3>
          <p className={styles.noteText}>
            全ての発券済みチケットを削除し、残席・チケット採番・生徒別発券数のカウンターをリセットします。
          </p>
          <button
            type='button'
            className={`${styles.authButton} ${styles.settingModalConfirmDanger}`}
            onClick={() => setShowDeleteAllTicketsModal(true)}
            disabled={
              isDeletingAllAccounts ||
              isDeletingAllTickets ||
              isDeletingAllLeaderboard ||
              isDeletingAllOrganizationAdmins ||
              isResettingAllLikes
            }
          >
            全てのチケットを削除してカウンターをリセット
          </button>
          <h3>いいねの消去</h3>
          <p className={styles.noteText}>
            全てのクラス公演・体育館公演・展示公演のいいね数をゼロに戻します。
          </p>
          <button
            type='button'
            className={`${styles.authButton} ${styles.settingModalConfirmDanger}`}
            onClick={() => setShowResetAllLikesModal(true)}
            disabled={
              isDeletingAllAccounts ||
              isDeletingAllTickets ||
              isDeletingAllLeaderboard ||
              isDeletingAllOrganizationAdmins ||
              isResettingAllLikes
            }
          >
            全てのいいねを消去
          </button>
          <h3>隠しミニゲームのランキング削除</h3>
          <p className={styles.noteText}>
            隠しミニゲームのランキングを全て削除します。
          </p>
          <button
            type='button'
            className={`${styles.authButton} ${styles.settingModalConfirmDanger}`}
            onClick={() => setShowDeleteAllLeaderboardModal(true)}
            disabled={
              isDeletingAllAccounts ||
              isDeletingAllTickets ||
              isDeletingAllLeaderboard ||
              isDeletingAllOrganizationAdmins ||
              isResettingAllLikes
            }
          >
            隠しミニゲームのランキングを全消去
          </button>
          <h3>生徒アカウントの削除</h3>
          <button
            type='button'
            className={`${styles.authButton} ${styles.settingModalConfirmDanger}`}
            onClick={() => {
              setPendingDeleteAccountType('student');
              setShowDeleteAllAccountsModal(true);
            }}
            disabled={
              isDeletingAllAccounts ||
              isDeletingAllTickets ||
              isDeletingAllLeaderboard ||
              isDeletingAllOrganizationAdmins ||
              isResettingAllLikes
            }
          >
            全ての生徒アカウントを削除
          </button>
          <h3>中学生アカウントの削除</h3>
          <button
            type='button'
            className={`${styles.authButton} ${styles.settingModalConfirmDanger}`}
            onClick={() => {
              setPendingDeleteAccountType('junior');
              setShowDeleteAllAccountsModal(true);
            }}
            disabled={
              isDeletingAllAccounts ||
              isDeletingAllTickets ||
              isDeletingAllLeaderboard ||
              isDeletingAllOrganizationAdmins ||
              isResettingAllLikes
            }
          >
            全ての中学生アカウントを削除
          </button>
          <h3>管理者アカウントの削除</h3>
          <p className={styles.noteText}>
            全てのクラス・部活管理者アカウントを削除します。
          </p>
          <button
            type='button'
            className={`${styles.authButton} ${styles.settingModalConfirmDanger}`}
            onClick={() => setShowDeleteAllOrganizationAdminsModal(true)}
            disabled={
              isDeletingAllAccounts ||
              isDeletingAllTickets ||
              isDeletingAllLeaderboard ||
              isDeletingAllOrganizationAdmins
            }
          >
            全ての管理者アカウントを削除
          </button>
        </div>
        {settingsMessageScope === 'deletionTool' && settingsError && (
          <p className={styles.authError}>{settingsError}</p>
        )}
        {settingsMessageScope === 'deletionTool' && settingsSuccess && (
          <p className={styles.authSuccess}>{settingsSuccess}</p>
        )}
      </NormalSection>
      <NormalSection>
        <h2>パスワード変更</h2>
        <form className={styles.passwordForm} onSubmit={handlePasswordChange}>
          <label className={styles.authLabel} htmlFor='admin-current-password'>
            現在の管理者パスワード
          </label>
          <input
            type='text'
            name='username'
            value='admin'
            autocomplete='username'
            style='display: none;'
            aria-hidden='true'
          />
          <input
            id='admin-current-password'
            type='password'
            className={styles.authInput}
            value={currentPassword}
            onInput={(event) =>
              setCurrentPassword((event.target as HTMLInputElement).value)
            }
            autoComplete='current-password'
            required
          />
          <label className={styles.authLabel} htmlFor='admin-new-password'>
            新しい管理者パスワード
          </label>
          <input
            id='admin-new-password'
            type='password'
            className={styles.authInput}
            value={newPassword}
            onInput={(event) =>
              setNewPassword((event.target as HTMLInputElement).value)
            }
            autoComplete='new-password'
            minLength={8}
            required
          />
          <label
            className={styles.authLabel}
            htmlFor='admin-new-password-confirm'
          >
            新しい管理者パスワード（確認）
          </label>
          <input
            id='admin-new-password-confirm'
            type='password'
            className={styles.authInput}
            value={confirmNewPassword}
            onInput={(event) =>
              setConfirmNewPassword((event.target as HTMLInputElement).value)
            }
            autoComplete='new-password'
            minLength={8}
            required
          />
          {passwordChangeError && (
            <p className={styles.authError}>{passwordChangeError}</p>
          )}
          {passwordChangeSuccess && (
            <p className={styles.authSuccess}>{passwordChangeSuccess}</p>
          )}
          <button
            type='submit'
            className={styles.authButton}
            disabled={isChangingPassword}
          >
            {isChangingPassword ? '変更中...' : 'パスワードを変更'}
          </button>
        </form>
      </NormalSection>
      {isMaintenanceEndModalOpen && (
        <div className={styles.settingModalOverlay} role='presentation'>
          <div
            className={styles.settingModal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='maintenance-end-modal-title'
          >
            <h3
              id='maintenance-end-modal-title'
              className={styles.settingModalTitle}
            >
              メンテナンス終了予定時刻
            </h3>
            <p>
              メンテナンスモードを有効にするには終了予定時刻の設定が必要です。
            </p>
            <label
              className={styles.settingLabel}
              htmlFor='maintenance-end-modal-input'
            >
              終了予定日時
            </label>
            <input
              id='maintenance-end-modal-input'
              className={styles.fieldControl}
              type='datetime-local'
              value={maintenanceEndsAtDraft}
              onInput={(event) =>
                setMaintenanceEndsAtDraft(
                  (event.target as HTMLInputElement).value,
                )
              }
              disabled={isModalSubmitting}
              required
            />
            <div className={styles.settingModalActions}>
              <button
                type='button'
                className={styles.settingModalCancel}
                onClick={() => setIsMaintenanceEndModalOpen(false)}
                disabled={isModalSubmitting}
              >
                キャンセル
              </button>
              <button
                type='button'
                className={styles.settingModalConfirm}
                disabled={!maintenanceEndsAtDraft || isModalSubmitting}
                onClick={() =>
                  void saveMaintenanceMode(
                    true,
                    new Date(maintenanceEndsAtDraft).toISOString(),
                  )
                }
              >
                {isModalSubmitting ? '保存中...' : '有効にする'}
              </button>
            </div>
          </div>
        </div>
      )}
      {editingNumericKey && (
        <div
          className={styles.settingModalOverlay}
          role='presentation'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeNumericEditModal();
            }
          }}
        >
          <div
            className={styles.settingModal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='settings-edit-title'
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id='settings-edit-title' className={styles.settingModalTitle}>
              {NUMERIC_SETTING_META[editingNumericKey].label}
              を変更
            </h3>
            <input
              className={styles.fieldControl}
              type='number'
              min={NUMERIC_SETTING_META[editingNumericKey].min}
              max={NUMERIC_SETTING_META[editingNumericKey].max}
              value={editingNumericValue}
              onInput={(event) =>
                setEditingNumericValue((event.target as HTMLInputElement).value)
              }
            />
            {hasMultipleTicketCapacitySettings(editingNumericKey) && (
              <Alert type='warning'>
                <p>{ticketCapacityUpdateWarning(editingNumericKey)}</p>
              </Alert>
            )}
            {settingsMessageScope === 'modal' && settingsError && (
              <p className={styles.authError}>{settingsError}</p>
            )}
            {settingsMessageScope === 'modal' && settingsSuccess && (
              <p className={styles.authSuccess}>{settingsSuccess}</p>
            )}
            <div className={styles.settingModalActions}>
              <button
                type='button'
                className={styles.settingModalCancel}
                onClick={closeNumericEditModal}
                disabled={isModalSubmitting}
              >
                キャンセル
              </button>
              <button
                type='button'
                className={styles.settingModalConfirm}
                onClick={handleConfirmNumericEdit}
                disabled={isModalSubmitting}
              >
                {isModalSubmitting ? '同期中...' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingGymClub && (
        <div
          className={styles.settingModalOverlay}
          role='presentation'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeGymClubLimitEditModal();
            }
          }}
        >
          <div
            className={styles.settingModal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='gym-club-limit-edit-title'
            onClick={(event) => event.stopPropagation()}
          >
            <h3
              id='gym-club-limit-edit-title'
              className={styles.settingModalTitle}
            >
              {editingGymClub}の発行上限数を変更
            </h3>
            <input
              className={styles.fieldControl}
              type='number'
              min='0'
              max='100'
              value={editingGymClubLimit}
              onInput={(event) =>
                setEditingGymClubLimit((event.target as HTMLInputElement).value)
              }
            />
            {settingsMessageScope === 'modal' && settingsError && (
              <p className={styles.authError}>{settingsError}</p>
            )}
            <div className={styles.settingModalActions}>
              <button
                type='button'
                className={styles.settingModalCancel}
                onClick={closeGymClubLimitEditModal}
                disabled={isModalSubmitting}
              >
                キャンセル
              </button>
              <button
                type='button'
                className={styles.settingModalConfirm}
                onClick={handleConfirmGymClubLimitEdit}
                disabled={isModalSubmitting}
              >
                {isModalSubmitting ? '同期中...' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingClassLimitId !== null && (
        <div
          className={styles.settingModalOverlay}
          role='presentation'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeClassLimitEditModal();
            }
          }}
        >
          <div
            className={styles.settingModal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='class-limit-edit-title'
            onClick={(event) => event.stopPropagation()}
          >
            <h3
              id='class-limit-edit-title'
              className={styles.settingModalTitle}
            >
              {settings.classTicketLimits.find(
                (item) => item.id === editingClassLimitId,
              )?.class_name ?? 'クラス'}
              の発行可能枚数を変更
            </h3>
            <input
              className={styles.fieldControl}
              type='number'
              min='0'
              max='100'
              value={editingClassLimit}
              onInput={(event) =>
                setEditingClassLimit((event.target as HTMLInputElement).value)
              }
            />
            {settingsMessageScope === 'modal' && settingsError && (
              <p className={styles.authError}>{settingsError}</p>
            )}
            <div className={styles.settingModalActions}>
              <button
                type='button'
                className={styles.settingModalCancel}
                onClick={closeClassLimitEditModal}
                disabled={isModalSubmitting}
              >
                キャンセル
              </button>
              <button
                type='button'
                className={styles.settingModalConfirm}
                onClick={handleConfirmClassLimitEdit}
                disabled={isModalSubmitting}
              >
                {isModalSubmitting ? '同期中...' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isBulkClassLimitModalOpen && (
        <div
          className={styles.settingModalOverlay}
          role='presentation'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeBulkClassLimitEditModal();
            }
          }}
        >
          <div
            className={styles.settingModal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='bulk-class-limit-edit-title'
            onClick={(event) => event.stopPropagation()}
          >
            <h3
              id='bulk-class-limit-edit-title'
              className={styles.settingModalTitle}
            >
              全クラスの発行可能枚数を変更
            </h3>
            <label className={styles.authLabel} htmlFor='bulk-class-limit'>
              発行可能枚数（0〜100）
            </label>
            <input
              id='bulk-class-limit'
              className={styles.fieldControl}
              type='number'
              min='0'
              max='100'
              value={bulkClassLimit}
              onInput={(event) =>
                setBulkClassLimit((event.target as HTMLInputElement).value)
              }
            />
            {settingsMessageScope === 'modal' && settingsError && (
              <p className={styles.authError}>{settingsError}</p>
            )}
            <div className={styles.settingModalActions}>
              <button
                type='button'
                className={styles.settingModalCancel}
                onClick={closeBulkClassLimitEditModal}
                disabled={isModalSubmitting}
              >
                キャンセル
              </button>
              <button
                type='button'
                className={styles.settingModalConfirm}
                onClick={handleConfirmBulkClassLimitEdit}
                disabled={isModalSubmitting}
              >
                {isModalSubmitting ? '同期中...' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingSchedule && (
        <div
          className={styles.settingModalOverlay}
          role='presentation'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeScheduleEditModal();
            }
          }}
        >
          <div
            className={styles.settingModal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='schedule-edit-title'
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id='schedule-edit-title' className={styles.settingModalTitle}>
              公演回を編集
            </h3>
            <label className={styles.authLabel} htmlFor='schedule-round-name'>
              公演回名
            </label>
            <input
              id='schedule-round-name'
              className={styles.fieldControl}
              value={editingSchedule.roundName}
              onInput={(event) =>
                setEditingSchedule((current) =>
                  current
                    ? {
                        ...current,
                        roundName: (event.target as HTMLInputElement).value,
                      }
                    : current,
                )
              }
            />
            <label className={styles.authLabel} htmlFor='schedule-start-at'>
              開始時刻
            </label>
            <input
              id='schedule-start-at'
              className={styles.fieldControl}
              type='datetime-local'
              value={editingSchedule.startAt}
              onInput={(event) =>
                setEditingSchedule((current) =>
                  current
                    ? {
                        ...current,
                        startAt: (event.target as HTMLInputElement).value,
                      }
                    : current,
                )
              }
            />
            <div className={styles.settingControlGroup}>
              <span className={styles.settingLabel}>有効にする</span>
              <Switch
                checked={editingSchedule.isActive}
                onChange={(isActive) =>
                  setEditingSchedule((current) =>
                    current ? { ...current, isActive } : current,
                  )
                }
              />
            </div>
            {settingsMessageScope === 'modal' && settingsError && (
              <p className={styles.authError}>{settingsError}</p>
            )}
            <div className={styles.settingModalActions}>
              <button
                type='button'
                className={styles.settingModalCancel}
                onClick={closeScheduleEditModal}
                disabled={isModalSubmitting}
              >
                キャンセル
              </button>
              <button
                type='button'
                className={styles.settingModalConfirm}
                onClick={handleConfirmScheduleEdit}
                disabled={isModalSubmitting}
              >
                {isModalSubmitting ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteAllAccountsModal && (
        <div
          className={styles.settingModalOverlay}
          role='presentation'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowDeleteAllAccountsModal(false);
            }
          }}
        >
          <div
            className={styles.settingModal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='delete-all-accounts-title'
            onClick={(event) => event.stopPropagation()}
          >
            <h3
              id='delete-all-accounts-title'
              className={styles.settingModalTitle}
            >
              {pendingDeleteAccountType === 'student'
                ? '全ての生徒アカウントを削除しますか？'
                : '全ての中学生アカウントを削除しますか？'}
            </h3>
            <p>
              この操作は取り消せません。
              {pendingDeleteAccountType === 'student'
                ? '全ての生徒アカウント'
                : '全ての中学生アカウント'}
              がAuthとpublic.usersの両方から削除されます。本当に実行しますか？
            </p>
            <div className={styles.settingModalActions}>
              <button
                type='button'
                className={styles.settingModalCancel}
                onClick={() => setShowDeleteAllAccountsModal(false)}
                disabled={isDeletingAllAccounts}
              >
                キャンセル
              </button>
              <button
                type='button'
                className={`${styles.settingModalConfirm} ${styles.settingModalConfirmDanger}`}
                onClick={handleDeleteAllAccounts}
                disabled={isDeletingAllAccounts}
              >
                {isDeletingAllAccounts ? '削除中...' : '削除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteAllTicketsModal && (
        <div
          className={styles.settingModalOverlay}
          role='presentation'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowDeleteAllTicketsModal(false);
            }
          }}
        >
          <div
            className={styles.settingModal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='delete-all-tickets-title'
            onClick={(event) => event.stopPropagation()}
          >
            <h3
              id='delete-all-tickets-title'
              className={styles.settingModalTitle}
            >
              全てのチケットを削除してカウンターをリセットしますか？
            </h3>
            <p>
              この操作は取り消せません。全ての発券済みチケットが削除され、残席・チケット採番・生徒別発券数のカウンターがリセットされます。本当に実行しますか？
            </p>
            <div className={styles.settingModalActions}>
              <button
                type='button'
                className={styles.settingModalCancel}
                onClick={() => setShowDeleteAllTicketsModal(false)}
                disabled={isDeletingAllTickets}
              >
                キャンセル
              </button>
              <button
                type='button'
                className={`${styles.settingModalConfirm} ${styles.settingModalConfirmDanger}`}
                onClick={handleDeleteAllTickets}
                disabled={isDeletingAllTickets}
              >
                {isDeletingAllTickets ? '削除中...' : '削除してリセット'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteAllLeaderboardModal && (
        <div
          className={styles.settingModalOverlay}
          role='presentation'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowDeleteAllLeaderboardModal(false);
            }
          }}
        >
          <div
            className={styles.settingModal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='delete-all-leaderboard-title'
            onClick={(event) => event.stopPropagation()}
          >
            <h3
              id='delete-all-leaderboard-title'
              className={styles.settingModalTitle}
            >
              隠しミニゲームのランキングを全消去しますか？
            </h3>
            <p>
              この操作は取り消せません。全てのランキング記録が削除されます。本当に実行しますか？
            </p>
            <div className={styles.settingModalActions}>
              <button
                type='button'
                className={styles.settingModalCancel}
                onClick={() => setShowDeleteAllLeaderboardModal(false)}
                disabled={isDeletingAllLeaderboard}
              >
                キャンセル
              </button>
              <button
                type='button'
                className={`${styles.settingModalConfirm} ${styles.settingModalConfirmDanger}`}
                onClick={handleDeleteAllLeaderboard}
                disabled={isDeletingAllLeaderboard}
              >
                {isDeletingAllLeaderboard ? '削除中...' : '全消去'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showResetAllLikesModal && (
        <div
          className={styles.settingModalOverlay}
          role='presentation'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowResetAllLikesModal(false);
            }
          }}
        >
          <div
            className={styles.settingModal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='reset-all-likes-title'
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id='reset-all-likes-title' className={styles.settingModalTitle}>
              全てのいいねを消去しますか？
            </h3>
            <p>
              この操作は取り消せません。全てのクラス公演・体育館公演・展示公演のいいね数がゼロになります。本当に実行しますか？
            </p>
            <div className={styles.settingModalActions}>
              <button
                type='button'
                className={styles.settingModalCancel}
                onClick={() => setShowResetAllLikesModal(false)}
                disabled={isResettingAllLikes}
              >
                キャンセル
              </button>
              <button
                type='button'
                className={`${styles.settingModalConfirm} ${styles.settingModalConfirmDanger}`}
                onClick={handleResetAllLikes}
                disabled={isResettingAllLikes}
              >
                {isResettingAllLikes ? '消去中...' : '全消去'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteAllOrganizationAdminsModal && (
        <div
          className={styles.settingModalOverlay}
          role='presentation'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowDeleteAllOrganizationAdminsModal(false);
            }
          }}
        >
          <div
            className={styles.settingModal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='delete-all-organization-admins-title'
            onClick={(event) => event.stopPropagation()}
          >
            <h3
              id='delete-all-organization-admins-title'
              className={styles.settingModalTitle}
            >
              全ての管理者アカウントを削除しますか？
            </h3>
            <p>
              この操作は取り消せません。全てのクラス・部活管理者アカウントと、そのログインセッションが削除されます。本当に実行しますか？
            </p>
            <div className={styles.settingModalActions}>
              <button
                type='button'
                className={styles.settingModalCancel}
                onClick={() => setShowDeleteAllOrganizationAdminsModal(false)}
                disabled={isDeletingAllOrganizationAdmins}
              >
                キャンセル
              </button>
              <button
                type='button'
                className={`${styles.settingModalConfirm} ${styles.settingModalConfirmDanger}`}
                onClick={handleDeleteAllOrganizationAdmins}
                disabled={isDeletingAllOrganizationAdmins}
              >
                {isDeletingAllOrganizationAdmins ? '削除中...' : '削除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isDeletingAllAccounts && (
        <div className={styles.settingModalOverlay}>
          <LoadingSpinner
            message={
              pendingDeleteAccountType === 'student'
                ? '全ての生徒アカウントを削除中です...'
                : '全ての中学生アカウントを削除中です...'
            }
          />
        </div>
      )}

      {isDeletingAllTickets && (
        <div className={styles.settingModalOverlay}>
          <LoadingSpinner message='全てのチケットを削除し、カウンターをリセット中です...' />
        </div>
      )}

      {isDeletingAllLeaderboard && (
        <div className={styles.settingModalOverlay}>
          <LoadingSpinner message='隠しミニゲームのランキングを全消去中です...' />
        </div>
      )}

      {isResettingAllLikes && (
        <div className={styles.settingModalOverlay}>
          <LoadingSpinner message='全てのいいねを消去中です...' />
        </div>
      )}

      {isDeletingAllOrganizationAdmins && (
        <div className={styles.settingModalOverlay}>
          <LoadingSpinner message='全ての管理者アカウントを削除中です...' />
        </div>
      )}
    </div>
  );
};

const Settings = () => {
  useTitle('コントロールパネル - 管理画面');
  return (
    <AdminAuthLayout
      title='コントロールパネル'
      description='システム全体設定と管理者セキュリティをここで管理します。'
    >
      <SettingsContent />
    </AdminAuthLayout>
  );
};

export default Settings;
