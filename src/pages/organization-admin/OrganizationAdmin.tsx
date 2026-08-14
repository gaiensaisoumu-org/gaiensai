import { useEffect, useMemo, useState } from 'preact/hooks';
import Alert from '../../components/ui/Alert';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import NormalSection from '../../components/ui/NormalSection';
import Switch from '../../components/ui/Switch';
import { getPerformanceImageUrl, supabase } from '../../lib/supabase';
import { preparePerformanceImage } from '../../lib/performanceImage';
import { readErrorMessage } from '../../layout/AdminAuthLayout';
import { useTitle } from '../../hooks/useTitle';
import { formatTicketCode } from '../../features/tickets/formatTicketCode';
import { downloadRosterXlsx } from '../../features/tickets/downloadRosterXlsx';
import styles from './OrganizationAdmin.module.css';
import subPageStyles from '../../styles/sub-pages.module.css';

const TOKEN_KEY = 'organization_admin_session_v1';
const NAME_DIRECTORY_STORAGE_PREFIX = 'organization_admin_name_directory_v1';
const NAME_DIRECTORY_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const sessionHeaders = () => ({
  'x-organization-admin-session-token': localStorage.getItem(TOKEN_KEY) ?? '',
});

type TicketLink = {
  id: string;
  round_id?: number;
  round_name: string;
  tickets: {
    id: string;
    code: string;
    created_at: string;
    relationship: number;
    users: { affiliation: number | null } | null;
  };
};
type PerformanceRound = { id: number; name: string };
type StatusRatio = { completed: number; total: number };
type OrganizationStatus = {
  initialRegistration?: StatusRatio;
  ticketIssuance: StatusRatio;
  performanceCapacity?: StatusRatio;
  ranking: { affiliation: number | null; ticketCount: number }[];
};
type GymScheduleDraft = {
  id: number;
  roundName: string;
  startAt: string;
  endAt: string;
};
type Dashboard = {
  username: string;
  kind: 'class' | 'gym' | 'exhibition';
  performance: Record<string, unknown>;
  performances: Record<string, unknown>[];
  rounds: PerformanceRound[];
  tickets: TicketLink[];
  relationships: { id: number; name: string }[];
  gymTicketLimit?: number;
  status?: OrganizationStatus;
};
type MessageScope = 'performance' | 'image' | 'ticketSettings' | 'password';
type NameDirectory = Record<string, string>;
type StoredNameDirectory = {
  expiresAt: number;
  names: NameDirectory;
};

const exportRosterXlsx = async (
  organizationName: string,
  tickets: TicketLink[],
  rounds: PerformanceRound[],
  relationships: { id: number; name: string }[],
  generalCapacity: number,
  namesByAffiliation: NameDirectory,
) => {
  const performances = [
    ...rounds,
    ...tickets
      .filter((ticket) => !rounds.some((round) => round.id === ticket.round_id))
      .map((ticket) => ({
        id: ticket.round_id ?? -1,
        name: ticket.round_name,
      })),
  ];
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');

  const localDate = `${yyyy}-${mm}-${dd}`;
  await downloadRosterXlsx({
    rosters: [
      {
        name: organizationName,
        rounds: performances,
        tickets: tickets.map((ticket) => ({
          affiliation: ticket.tickets.users?.affiliation ?? null,
          name:
            namesByAffiliation[
              String(ticket.tickets.users?.affiliation ?? '')
            ] ?? '',
          relationship: ticket.tickets.relationship,
          code: ticket.tickets.code,
          createdAt: ticket.tickets.created_at,
          roundId: ticket.round_id ?? -1,
        })),
        generalCapacity,
      },
    ],
    relationships,
    filename: `招待者名簿_${organizationName}_${localDate}.xlsx`,
  });
};

const formatAffiliation = (affiliation: number | null | undefined) => {
  if (!affiliation || affiliation < 10000) {
    return '—';
  }
  return `${Math.floor(affiliation / 10000)}年${Math.floor(
    (affiliation % 10000) / 100,
  )}組${affiliation % 100}番`;
};

const isStudentAffiliation = (
  affiliation: number | null | undefined,
): affiliation is number =>
  typeof affiliation === 'number' &&
  Number.isInteger(affiliation) &&
  affiliation >= 10000 &&
  affiliation <= 39999;

const affiliationClassKey = (affiliation: number) =>
  `${Math.floor(affiliation / 10000)}-${Math.floor((affiliation % 10000) / 100)}`;

const classNameKey = (className: unknown) => {
  const digits = String(className ?? '').match(/(\d+)\D+(\d+)/);
  return digits ? `${Number(digits[1])}-${Number(digits[2])}` : null;
};

const StatusDonut = ({
  label,
  ratio,
}: {
  label: string;
  ratio: StatusRatio;
}) => {
  const percentage =
    ratio.total > 0
      ? Math.round((ratio.completed / ratio.total) * 1000) / 10
      : 0;
  return (
    <div className={styles.statusCard}>
      <h3>{label}</h3>
      <div
        className={styles.donut}
        style={`--progress: ${percentage}%;`}
        role='img'
        aria-label={`${label} ${percentage}%（${ratio.completed}人 / ${ratio.total}人）`}
      >
        <div>
          <strong>{ratio.total > 0 ? `${percentage}%` : '—'}</strong>
          <span>
            {ratio.completed} / {ratio.total} 人
          </span>
        </div>
      </div>
    </div>
  );
};

const nameDirectoryStorageKey = (
  kind: Dashboard['kind'],
  organizationName: string,
) => `${NAME_DIRECTORY_STORAGE_PREFIX}:${kind}:${organizationName}`;

const readNameDirectory = (storageKey: string): NameDirectory => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as StoredNameDirectory;
    if (
      !parsed ||
      typeof parsed.expiresAt !== 'number' ||
      parsed.expiresAt <= Date.now()
    ) {
      localStorage.removeItem(storageKey);
      return {};
    }
    if (
      !parsed.names ||
      typeof parsed.names !== 'object' ||
      Array.isArray(parsed.names)
    ) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed.names).filter(
        ([affiliation, name]) =>
          /^\d+$/.test(affiliation) && typeof name === 'string',
      ),
    );
  } catch {
    localStorage.removeItem(storageKey);
    return {};
  }
};

const toDateTimeLocal = (value: unknown) => {
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
};

const OrganizationAdmin = () => {
  useTitle('クラス・部活管理');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [messageScope, setMessageScope] = useState<MessageScope | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [isAccepting, setIsAccepting] = useState(false);
  const [capacity, setCapacity] = useState('');
  const [juniorCapacity, setJuniorCapacity] = useState('');
  const [classTicketLimit, setClassTicketLimit] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [roundFilter, setRoundFilter] = useState('all');
  const [showCapacityModal, setShowCapacityModal] = useState(false);
  const [showGymTicketLimitModal, setShowGymTicketLimitModal] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageVersion, setImageVersion] = useState(0);
  const [draftCapacity, setDraftCapacity] = useState('');
  const [draftJuniorCapacity, setDraftJuniorCapacity] = useState('');
  const [draftClassTicketLimit, setDraftClassTicketLimit] = useState('');
  const [draftGymTicketLimit, setDraftGymTicketLimit] = useState('');
  const [gymScheduleDrafts, setGymScheduleDrafts] = useState<
    GymScheduleDraft[]
  >([]);
  const [namesByAffiliation, setNamesByAffiliation] = useState<NameDirectory>(
    {},
  );
  const [loadedNameDirectoryKey, setLoadedNameDirectoryKey] = useState<
    string | null
  >(null);
  const [editingAffiliation, setEditingAffiliation] = useState<number | null>(
    null,
  );
  const [nameDraft, setNameDraft] = useState('');
  const [transferText, setTransferText] = useState('');
  const [nameNotice, setNameNotice] = useState<string | null>(null);
  const [showMissingAffiliationModal, setShowMissingAffiliationModal] =
    useState(false);

  const triggerRedeploy = async () => {
    const { data, error } = await supabase.functions.invoke(
      'organization-admin',
      {
        body: { action: 'triggerRedeploy' },
        headers: sessionHeaders(),
      },
    );
    if (error || !data?.redeployTriggered) {
      throw error ?? new Error('再デプロイを開始できませんでした。');
    }
  };

  const nameDirectoryKey = useMemo(() => {
    if (!dashboard || dashboard.kind === 'exhibition') {
      return null;
    }
    const organizationName = String(
      dashboard.kind === 'class'
        ? (dashboard.performance.class_name ?? '')
        : (dashboard.performance.group_name ?? ''),
    );
    return nameDirectoryStorageKey(dashboard.kind, organizationName);
  }, [dashboard]);

  useEffect(() => {
    if (!nameDirectoryKey) {
      setNamesByAffiliation({});
      setLoadedNameDirectoryKey(null);
      return;
    }
    setNamesByAffiliation(readNameDirectory(nameDirectoryKey));
    setLoadedNameDirectoryKey(nameDirectoryKey);
    setEditingAffiliation(null);
    setNameNotice(null);
  }, [nameDirectoryKey]);

  useEffect(() => {
    if (!nameDirectoryKey || loadedNameDirectoryKey !== nameDirectoryKey) {
      return;
    }
    localStorage.setItem(
      nameDirectoryKey,
      JSON.stringify({
        expiresAt: Date.now() + NAME_DIRECTORY_TTL_MS,
        names: namesByAffiliation,
      }),
    );
  }, [loadedNameDirectoryKey, nameDirectoryKey, namesByAffiliation]);

  const load = async () => {
    const { data, error: invokeError } = await supabase.functions.invoke(
      'organization-admin',
      {
        body: { action: 'getDashboard' },
        headers: sessionHeaders(),
      },
    );
    if (invokeError) {
      throw invokeError;
    }
    const next = data as Dashboard;
    setDashboard(next);
    setTitle(String(next.performance.title ?? ''));
    setDescription(String(next.performance.description ?? ''));
    setLocation(String(next.performance.location ?? ''));
    setIsAccepting(Boolean(next.performance.is_accepting));
    setCapacity(
      String(
        next.kind === 'class'
          ? (next.performance.total_capacity ?? '')
          : (next.performance.capacity ?? ''),
      ),
    );
    setJuniorCapacity(String(next.performance.junior_capacity ?? ''));
    setClassTicketLimit(String(next.performance.max_tickets_per_user ?? ''));
    setGymScheduleDrafts(
      next.kind === 'gym'
        ? (next.performances ?? []).map((performance) => ({
            id: Number(performance.id),
            roundName: String(performance.round_name ?? '公演回'),
            startAt: toDateTimeLocal(performance.start_at),
            endAt: toDateTimeLocal(performance.end_at),
          }))
        : [],
    );
  };

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      setChecking(false);
      return;
    }
    load()
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setChecking(false));
  }, []);

  const login = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        'organization-admin',
        { body: { action: 'login', username, password } },
      );
      if (invokeError) {
        throw invokeError;
      }
      if (!data?.authenticated || typeof data.sessionToken !== 'string') {
        setError('ユーザー名またはパスワードが正しくありません。');
        return;
      }
      localStorage.setItem(TOKEN_KEY, data.sessionToken);
      setPassword('');
      await load();
    } catch (cause) {
      setError(await readErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    const sessionToken = localStorage.getItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    setDashboard(null);
    setUsername('');
    setPassword('');
    setError(null);
    setNotice(null);
    setMessageScope(null);
    setBusy(false);

    if (sessionToken) {
      void supabase.functions
        .invoke('organization-admin', {
          body: { action: 'logout' },
          headers: { 'x-organization-admin-session-token': sessionToken },
        })
        .catch(() => {
          // ローカルのセッションは、通信に失敗しても必ず破棄する。
        });
    }
  };

  const save = async (event: Event) => {
    event.preventDefault();
    if (
      dashboard?.kind === 'gym' &&
      gymScheduleDrafts.some(
        (schedule) =>
          !schedule.startAt ||
          !schedule.endAt ||
          new Date(schedule.startAt) >= new Date(schedule.endAt),
      )
    ) {
      setMessageScope('performance');
      setError('各公演回の終了時刻は開始時刻より後に設定してください。');
      return;
    }
    setBusy(true);
    setMessageScope('performance');
    setError(null);
    setNotice(null);
    try {
      const { error: invokeError } = await supabase.functions.invoke(
        'organization-admin',
        {
          body: {
            action: 'updatePerformance',
            title,
            description,
            location,
            ...(dashboard?.kind === 'exhibition' ? {} : { isAccepting }),
            ...(dashboard?.kind === 'gym'
              ? {
                  scheduleTimes: gymScheduleDrafts.map((schedule) => ({
                    id: schedule.id,
                    startAt: new Date(schedule.startAt).toISOString(),
                    endAt: new Date(schedule.endAt).toISOString(),
                  })),
                }
              : {}),
          },
          headers: sessionHeaders(),
        },
      );
      if (invokeError) {
        throw invokeError;
      }
      await load();
      await triggerRedeploy();
      setNotice('公演情報を更新し、再デプロイを開始しました。');
    } catch (cause) {
      setError(await readErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const uploadImage = async (event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }
    setError(null);
    setNotice(null);
    setMessageScope('image');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('JPEG・PNG・WebP形式の画像を選択してください。');
      return;
    }
    setIsUploadingImage(true);
    try {
      const uploadFile = await preparePerformanceImage(file);
      if (uploadFile.size > 5 * 1024 * 1024) {
        throw new Error('変換後の画像ファイルは5MB以下にしてください。');
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () =>
          reject(new Error('画像の読み込みに失敗しました。'));
        reader.readAsDataURL(uploadFile);
      });
      const base64 = dataUrl.split(',')[1];
      const { error: invokeError } = await supabase.functions.invoke(
        'organization-admin',
        {
          body: { action: 'uploadImage', contentType: uploadFile.type, base64 },
          headers: sessionHeaders(),
        },
      );
      if (invokeError) {
        throw invokeError;
      }
      await load();
      setImageVersion(Date.now());
      await triggerRedeploy();
      setNotice('公演画像を更新し、再デプロイを開始しました。');
    } catch (cause) {
      setError(await readErrorMessage(cause));
    } finally {
      setIsUploadingImage(false);
      (event.target as HTMLInputElement).value = '';
    }
  };

  const changePassword = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    setMessageScope('password');
    setError(null);
    setNotice(null);
    try {
      if (newPassword.length < 8) {
        throw new Error('新しいパスワードは8文字以上で入力してください。');
      }
      if (newPassword !== confirmPassword) {
        throw new Error('新しいパスワードと確認用パスワードが一致しません。');
      }
      const { error: invokeError } = await supabase.functions.invoke(
        'organization-admin',
        {
          body: { action: 'changePassword', currentPassword, newPassword },
          headers: sessionHeaders(),
        },
      );
      if (invokeError) {
        throw invokeError;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice('パスワードを変更しました。');
    } catch (cause) {
      setError(await readErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const saveTicketSettings = async (
    nextIsAccepting: boolean,
    nextCapacity = capacity,
    nextJuniorCapacity = juniorCapacity,
    nextClassTicketLimit = classTicketLimit,
  ) => {
    setBusy(true);
    setMessageScope('ticketSettings');
    setError(null);
    setNotice(null);
    try {
      const capacityValue = Number(nextCapacity);
      const juniorCapacityValue = Number(nextJuniorCapacity);
      const classTicketLimitValue = Number(nextClassTicketLimit);
      if (!Number.isInteger(capacityValue) || capacityValue < 1) {
        throw new Error('定員は1人以上の整数で入力してください。');
      }
      if (
        !Number.isInteger(juniorCapacityValue) ||
        juniorCapacityValue < 0 ||
        juniorCapacityValue > capacityValue
      ) {
        throw new Error('中学生枠は0〜定員の範囲で入力してください。');
      }
      if (
        dashboard?.kind === 'class' &&
        (!Number.isInteger(classTicketLimitValue) ||
          classTicketLimitValue < 0 ||
          classTicketLimitValue > 100)
      ) {
        throw new Error(
          '自クラスの発行可能枚数は0〜100の整数で入力してください。',
        );
      }
      const { error: invokeError } = await supabase.functions.invoke(
        'organization-admin',
        {
          body: {
            action: 'updateTicketSettings',
            isAccepting: nextIsAccepting,
            capacity: capacityValue,
            juniorCapacity: juniorCapacityValue,
            ...(dashboard?.kind === 'class'
              ? { maxTicketsPerUser: classTicketLimitValue }
              : {}),
          },
          headers: sessionHeaders(),
        },
      );
      if (invokeError) {
        throw invokeError;
      }
      await load();
      setNotice('受付・定員設定を更新しました。');
      return true;
    } catch (cause) {
      setError(await readErrorMessage(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleAcceptingChange = async (nextIsAccepting: boolean) => {
    const previous = isAccepting;
    setIsAccepting(nextIsAccepting);
    const saved = await saveTicketSettings(nextIsAccepting);
    if (!saved) {
      setIsAccepting(previous);
    }
  };

  const openCapacityModal = () => {
    setDraftCapacity(capacity);
    setDraftJuniorCapacity(juniorCapacity);
    setDraftClassTicketLimit(classTicketLimit);
    setShowCapacityModal(true);
  };

  const openGymTicketLimitModal = () => {
    setDraftGymTicketLimit(String(dashboard?.gymTicketLimit ?? ''));
    setShowGymTicketLimitModal(true);
  };

  const saveGymTicketLimit = async (event: Event) => {
    event.preventDefault();
    const limit = Number(draftGymTicketLimit);
    if (!Number.isInteger(limit) || limit < 0 || limit > 100) {
      setMessageScope('ticketSettings');
      setError('発行上限数は0〜100の範囲の整数で入力してください。');
      return;
    }
    setBusy(true);
    setMessageScope('ticketSettings');
    setError(null);
    setNotice(null);
    try {
      const { error: invokeError } = await supabase.functions.invoke(
        'organization-admin',
        {
          body: { action: 'updateGymTicketLimit', limit },
          headers: sessionHeaders(),
        },
      );
      if (invokeError) {
        throw invokeError;
      }
      await load();
      setShowGymTicketLimitModal(false);
      setNotice('体育館公演チケットの発行上限数を更新しました。');
    } catch (cause) {
      setError(await readErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const saveCapacitySettings = async (event: Event) => {
    event.preventDefault();
    const saved = await saveTicketSettings(
      isAccepting,
      draftCapacity,
      draftJuniorCapacity,
      draftClassTicketLimit,
    );
    if (saved) {
      setShowCapacityModal(false);
    }
  };

  const roundsForFilter = useMemo(
    () => [...(dashboard?.rounds ?? [])].sort((a, b) => a.id - b.id),
    [dashboard],
  );
  const displayedTickets = useMemo(
    () =>
      dashboard?.tickets
        .filter(
          (ticket) =>
            roundFilter === 'all' ||
            ticket.round_id === Number(roundFilter) ||
            (ticket.round_id === undefined &&
              ticket.round_name ===
                roundsForFilter.find(
                  (round) => round.id === Number(roundFilter),
                )?.name),
        )
        .slice()
        .sort(
          (a, b) =>
            (a.tickets.users?.affiliation ?? Number.MAX_SAFE_INTEGER) -
              (b.tickets.users?.affiliation ?? Number.MAX_SAFE_INTEGER) ||
            a.tickets.code.localeCompare(b.tickets.code, 'ja'),
        ) ?? [],
    [dashboard, roundFilter, roundsForFilter],
  );
  const relationshipNames = useMemo(
    () =>
      new Map(
        dashboard?.relationships.map((relationship) => [
          relationship.id,
          relationship.name,
        ]) ?? [],
      ),
    [dashboard],
  );
  const nameAffiliations = useMemo(() => {
    const classKey =
      dashboard?.kind === 'class'
        ? classNameKey(dashboard.performance.class_name)
        : null;
    return Array.from(
      new Set(
        (dashboard?.tickets ?? [])
          .map((ticket) => ticket.tickets.users?.affiliation)
          .filter(isStudentAffiliation)
          .filter(
            (affiliation) =>
              !classKey || affiliationClassKey(affiliation) === classKey,
          ),
      ),
    ).sort((a, b) => a - b);
  }, [dashboard]);
  const hasMissingName = nameAffiliations.some(
    (affiliation) => !namesByAffiliation[String(affiliation)]?.trim(),
  );
  const hasMissingAffiliation = Boolean(
    dashboard?.tickets.some(
      (ticket) => !isStudentAffiliation(ticket.tickets.users?.affiliation),
    ),
  );

  const saveName = (affiliation: number) => {
    const name = nameDraft.trim();
    setNamesByAffiliation((current) => {
      const next = { ...current };
      if (name) {
        next[String(affiliation)] = name;
      } else {
        delete next[String(affiliation)];
      }
      return next;
    });
    setEditingAffiliation(null);
  };

  const copyNameDirectory = async () => {
    const text = JSON.stringify({ names: namesByAffiliation });
    setTransferText(text);
    try {
      await navigator.clipboard.writeText(text);
      setNameNotice('コピーしました。他の端末で貼り付けて取り込めます。');
    } catch {
      setNameNotice('下のテキストをコピーして、他の端末に貼り付けてください。');
    }
  };

  const importNameDirectory = () => {
    try {
      const parsed = JSON.parse(transferText) as { names?: unknown };
      if (
        !parsed.names ||
        typeof parsed.names !== 'object' ||
        Array.isArray(parsed.names)
      ) {
        throw new Error();
      }
      const next = Object.fromEntries(
        Object.entries(parsed.names as Record<string, unknown>).flatMap(
          ([affiliation, name]) =>
            /^\d+$/.test(affiliation) && typeof name === 'string'
              ? [[affiliation, name.trim()]]
              : [],
        ),
      ) as NameDirectory;
      setNamesByAffiliation(next);
      setNameNotice('氏名データを取り込みました。');
    } catch {
      setNameNotice('取り込み用データの形式が正しくありません。');
    }
  };

  const exportRoster = () => {
    if (!dashboard) {
      return;
    }
    const organizationName = String(
      dashboard.kind === 'class'
        ? (dashboard.performance.class_name ?? '')
        : (dashboard.performance.group_name ?? ''),
    );
    const generalCapacity = Math.max(
      0,
      ...(dashboard.performances ?? [dashboard.performance]).map(
        (performance) => {
          const total = Number(
            dashboard.kind === 'class'
              ? performance.total_capacity
              : performance.capacity,
          );
          const junior = Number(performance.junior_capacity ?? 0);
          return Number.isFinite(total) && Number.isFinite(junior)
            ? total - junior
            : 0;
        },
      ),
    );
    void exportRosterXlsx(
      organizationName,
      dashboard.tickets,
      dashboard.rounds,
      dashboard.relationships,
      generalCapacity,
      namesByAffiliation,
    );
  };

  const requestRosterExport = () => {
    if (hasMissingAffiliation || hasMissingName) {
      setShowMissingAffiliationModal(true);
      return;
    }
    exportRoster();
  };
  if (checking) {
    return <LoadingSpinner message='認証状態を確認しています...' />;
  }
  if (!dashboard) {
    return (
      <>
        <h1 className={subPageStyles.pageTitle}>クラス・部活用管理ページ</h1>
        <div className={styles.shell} key='organization-admin-login'>
          <NormalSection>
            <h2>ログイン</h2>
            <form onSubmit={login} className={styles.form}>
              <label>
                ユーザー名
                <input
                  value={username}
                  onInput={(e) =>
                    setUsername((e.target as HTMLInputElement).value)
                  }
                  required
                  autoComplete='username'
                />
              </label>
              <label>
                パスワード
                <input
                  type='password'
                  value={password}
                  onInput={(e) =>
                    setPassword((e.target as HTMLInputElement).value)
                  }
                  required
                  autoComplete='current-password'
                />
              </label>
              {error && <Alert type='error'>{error}</Alert>}
              <button disabled={busy}>
                {busy ? 'ログイン中...' : 'ログイン'}
              </button>
            </form>
          </NormalSection>
        </div>
      </>
    );
  }

  const name =
    dashboard.kind === 'class'
      ? `${dashboard.performance.class_name} ${dashboard.performance.title || ''}`
      : String(dashboard.performance.group_name ?? '');
  return (
    <>
      <h1 className={subPageStyles.pageTitle}>クラス・部活用管理ページ</h1>
      <div className={styles.shell} key='organization-admin-dashboard'>
        <div className={styles.heading}>
          <div>
            <h2 className={subPageStyles.linedH2}>{name}</h2>
          </div>
          <button type='button' className={styles.secondary} onClick={logout}>
            ログアウト
          </button>
        </div>
        <NormalSection>
          <h2>{dashboard.kind === 'exhibition' ? '展示情報' : '公演情報'}</h2>
          <form onSubmit={save} className={styles.form}>
            {dashboard.kind === 'class' && (
              <label>
                公演タイトル
                <input
                  value={title}
                  maxLength={200}
                  onInput={(e) =>
                    setTitle((e.target as HTMLInputElement).value)
                  }
                  required
                />
              </label>
            )}
            <label>
              {dashboard.kind === 'exhibition' ? '展示説明' : '公演説明'}
              <textarea
                value={description}
                maxLength={2000}
                onInput={(e) =>
                  setDescription((e.target as HTMLTextAreaElement).value)
                }
              />
            </label>
            {dashboard.kind === 'exhibition' && (
              <label>
                場所
                <input
                  value={location}
                  maxLength={200}
                  onInput={(event) =>
                    setLocation((event.target as HTMLInputElement).value)
                  }
                />
              </label>
            )}
            {dashboard.kind === 'gym' && (
              <fieldset className={styles.scheduleTimes}>
                <legend>公演時間</legend>
                {gymScheduleDrafts.map((schedule, index) => (
                  <div className={styles.scheduleTimeRow} key={schedule.id}>
                    <strong>{schedule.roundName}</strong>
                    <label>
                      開始
                      <input
                        type='datetime-local'
                        value={schedule.startAt}
                        onInput={(event) =>
                          setGymScheduleDrafts((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    startAt: (event.target as HTMLInputElement)
                                      .value,
                                  }
                                : item,
                            ),
                          )
                        }
                        required
                      />
                    </label>
                    <label>
                      終了
                      <input
                        type='datetime-local'
                        value={schedule.endAt}
                        onInput={(event) =>
                          setGymScheduleDrafts((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    endAt: (event.target as HTMLInputElement)
                                      .value,
                                  }
                                : item,
                            ),
                          )
                        }
                        required
                      />
                    </label>
                  </div>
                ))}
              </fieldset>
            )}
            <button disabled={busy}>{busy ? '保存中...' : '変更を保存'}</button>
          </form>
          {messageScope === 'performance' && error && (
            <Alert type='error'>{error}</Alert>
          )}
          {messageScope === 'performance' && notice && (
            <Alert type='info'>{notice}</Alert>
          )}
        </NormalSection>
        <NormalSection>
          <h2>{dashboard.kind === 'exhibition' ? '展示画像' : '公演画像'}</h2>
          <div className={styles.imageSettings}>
            {typeof dashboard.performance.image_path === 'string' &&
              dashboard.performance.image_path && (
                <img
                  className={styles.performanceImagePreview}
                  src={getPerformanceImageUrl(
                    dashboard.performance.image_path,
                    imageVersion || undefined,
                  )}
                  alt='現在の公演画像'
                />
              )}
            <label className={styles.imageUploadLabel}>
              {isUploadingImage ? 'アップロード中...' : '画像を差し替える'}
              <input
                type='file'
                accept='image/jpeg,image/png,image/webp'
                onChange={uploadImage}
                disabled={isUploadingImage}
              />
            </label>
            <p className={styles.imageHint}>
              JPEG・PNGは横幅560pxのWebPに変換してアップロードします。WebPは5MB以下にしてください。
            </p>
          </div>
          {messageScope === 'image' && error && (
            <Alert type='error'>{error}</Alert>
          )}
          {messageScope === 'image' && notice && (
            <Alert type='info'>{notice}</Alert>
          )}
        </NormalSection>
        {dashboard.kind !== 'exhibition' && (
          <>
            {dashboard.status && (
              <NormalSection>
                <div className={styles.statusHeading}>
                  <div>
                    <h2>ステータス</h2>
                    <p>
                      発行済みは有効チケットを1枚以上発行した生徒、公演枠は中学生分を含む発行人数で集計しています。
                    </p>
                  </div>
                </div>
                <div className={styles.statusGrid}>
                  {dashboard.kind === 'class' &&
                    dashboard.status.initialRegistration && (
                      <StatusDonut
                        label='初回登録済み'
                        ratio={dashboard.status.initialRegistration}
                      />
                    )}
                  <StatusDonut
                    label='チケット発行済み'
                    ratio={dashboard.status.ticketIssuance}
                  />
                  {dashboard.status.performanceCapacity && (
                    <StatusDonut
                      label='公演枠の発行状況'
                      ratio={dashboard.status.performanceCapacity}
                    />
                  )}
                </div>
              </NormalSection>
            )}
            {dashboard.status && (
              <NormalSection>
                <h2>チケット発行枚数ランキング</h2>
                {dashboard.status.ranking.length === 0 ? (
                  <p className={styles.statusEmpty}>
                    まだ発行済みチケットはありません。
                  </p>
                ) : (
                  <ol className={styles.rankingList}>
                    {dashboard.status.ranking.map((entry, index) => (
                      <li key={`${entry.affiliation}-${index}`}>
                        <span className={styles.rank}>{index + 1}</span>
                        <span>{formatAffiliation(entry.affiliation)}</span>
                        <strong>{entry.ticketCount} 枚</strong>
                      </li>
                    ))}
                  </ol>
                )}
              </NormalSection>
            )}
            <NormalSection>
              <h2>受付・定員設定</h2>
              <div className={styles.settingsList}>
                <Alert type='warning'>
                  <ul>
                    <li>
                      定員はむやみに変更しないでください。変更があった場合は総務から理由の確認が入ることがあります。
                    </li>
                    <li>
                      チケット発行上限設定は自クラス・自部活の発行分だけに適用されます。他クラス・部活からの取得には影響しません。兼部している場合も部活ごとにカウントされるように変更しました。
                    </li>
                  </ul>
                </Alert>
                <div className={styles.settingRow}>
                  <span>チケット受付を有効にする</span>
                  <label>
                    <Switch
                      id='organization-is-accepting'
                      checked={isAccepting}
                      onChange={handleAcceptingChange}
                    />
                  </label>
                </div>
                <div className={styles.settingRow}>
                  <div>
                    <span>定員</span>
                    <p>
                      {capacity}人（中学生枠 {juniorCapacity}人）
                    </p>
                  </div>
                  <button
                    type='button'
                    className={styles.inlineEditButton}
                    onClick={openCapacityModal}
                    disabled={busy}
                  >
                    変更する
                  </button>
                </div>
                {dashboard.kind === 'class' && (
                  <div className={styles.settingRow}>
                    <div>
                      <span>自クラス・部活の最大発行可能枚数</span>
                      <p>{classTicketLimit}枚</p>
                    </div>
                    <button
                      type='button'
                      className={styles.inlineEditButton}
                      onClick={openCapacityModal}
                      disabled={busy}
                    >
                      変更する
                    </button>
                  </div>
                )}
                {dashboard.kind === 'gym' && (
                  <>
                    <div className={styles.settingRow}>
                      <div>
                        <span>部員のチケット発行上限</span>
                        <p>{dashboard.gymTicketLimit ?? 0}枚</p>
                      </div>
                      <button
                        type='button'
                        className={styles.inlineEditButton}
                        onClick={openGymTicketLimitModal}
                        disabled={busy}
                      >
                        変更する
                      </button>
                    </div>
                  </>
                )}
              </div>
              {messageScope === 'ticketSettings' && error && (
                <Alert type='error'>{error}</Alert>
              )}
              {messageScope === 'ticketSettings' && notice && (
                <Alert type='info'>{notice}</Alert>
              )}
            </NormalSection>
            <NormalSection>
              <div className={styles.ticketHeading}>
                <div>
                  <h2>氏名管理</h2>
                  <p>チケットを発行した生徒の氏名を登録できます</p>
                </div>
                <button
                  type='button'
                  className={styles.secondary}
                  onClick={() => void copyNameDirectory()}
                >
                  別端末移行用データをコピー
                </button>
              </div>
              <p className={styles.nameHint}>
                この端末に90日間保存されます。別の端末へ移す場合は、コピーしたデータを下欄に貼り付けて取り込んでください。
              </p>
              <div className={styles.tableWrap}>
                <table className={styles.nameTable}>
                  <thead>
                    <tr>
                      <th>学年・クラス・番号</th>
                      <th>氏名</th>
                      <th aria-label='操作' />
                    </tr>
                  </thead>
                  <tbody>
                    {nameAffiliations.map((affiliation) => (
                      <tr key={affiliation}>
                        <td>{formatAffiliation(affiliation)}</td>
                        <td>
                          {editingAffiliation === affiliation ? (
                            <input
                              className={styles.nameInput}
                              value={nameDraft}
                              maxLength={100}
                              onInput={(event) =>
                                setNameDraft(
                                  (event.target as HTMLInputElement).value,
                                )
                              }
                              aria-label={`${formatAffiliation(affiliation)}の氏名`}
                            />
                          ) : (
                            namesByAffiliation[String(affiliation)] || '—'
                          )}
                        </td>
                        <td>
                          {editingAffiliation === affiliation ? (
                            <button
                              type='button'
                              className={styles.inlineEditButton}
                              onClick={() => saveName(affiliation)}
                            >
                              保存
                            </button>
                          ) : (
                            <button
                              type='button'
                              className={styles.inlineEditButton}
                              onClick={() => {
                                setEditingAffiliation(affiliation);
                                setNameDraft(
                                  namesByAffiliation[String(affiliation)] ?? '',
                                );
                              }}
                            >
                              編集
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {nameAffiliations.length === 0 && (
                      <tr>
                        <td colSpan={3}>登録対象のチケットはありません。</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <label className={styles.transferLabel}>
                他の端末から取り込むデータ
                <textarea
                  value={transferText}
                  onInput={(event) =>
                    setTransferText((event.target as HTMLTextAreaElement).value)
                  }
                  placeholder='「別端末移行用データをコピー」でコピーした内容を貼り付け'
                />
              </label>
              <button
                type='button'
                className={styles.inlineEditButton}
                onClick={importNameDirectory}
              >
                貼り付けたデータを取り込む
              </button>
              {nameNotice && <Alert type='info'>{nameNotice}</Alert>}
            </NormalSection>
            <NormalSection>
              <div className={styles.ticketHeading}>
                <div>
                  <h2>チケット一覧</h2>
                  <p>有効 {displayedTickets.length} 枚</p>
                </div>
                <button type='button' onClick={requestRosterExport}>
                  名簿をExcel出力
                </button>
              </div>
              <label className={styles.filterLabel}>
                公演回
                <select
                  value={roundFilter}
                  onChange={(event) =>
                    setRoundFilter((event.target as HTMLSelectElement).value)
                  }
                >
                  <option value='all'>すべて</option>
                  {roundsForFilter.map((round) => (
                    <option key={round.id} value={round.id}>
                      {round.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>コード</th>
                      <th>公演回</th>
                      <th>学年・クラス・番号</th>
                      <th>間柄</th>
                      <th>発行日時</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedTickets.map(({ id, tickets, round_name }) => (
                      <tr key={id}>
                        <td>{formatTicketCode(tickets.code)}</td>
                        <td>{round_name}</td>
                        <td>{formatAffiliation(tickets.users?.affiliation)}</td>
                        <td>
                          {relationshipNames.get(tickets.relationship) ?? '—'}
                        </td>
                        <td>
                          {new Date(tickets.created_at).toLocaleString('ja-JP')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </NormalSection>
          </>
        )}
        <NormalSection>
          <h2>パスワード変更</h2>
          <form onSubmit={changePassword} className={styles.form}>
            <input
              type='text'
              name='username'
              value={dashboard.username}
              autocomplete='username'
              style='display: none;'
              aria-hidden='true'
            />
            <label>
              現在のパスワード
              <input
                type='password'
                value={currentPassword}
                onInput={(e) =>
                  setCurrentPassword((e.target as HTMLInputElement).value)
                }
                required
                autoComplete='current-password'
              />
            </label>
            <label>
              新しいパスワード
              <input
                type='password'
                value={newPassword}
                onInput={(e) =>
                  setNewPassword((e.target as HTMLInputElement).value)
                }
                required
                minLength={8}
                autoComplete='new-password'
              />
            </label>
            <label>
              新しいパスワード（確認）
              <input
                type='password'
                value={confirmPassword}
                onInput={(e) =>
                  setConfirmPassword((e.target as HTMLInputElement).value)
                }
                required
                minLength={8}
                autoComplete='new-password'
              />
            </label>
            <button disabled={busy}>パスワードを変更</button>
          </form>
          {messageScope === 'password' && error && (
            <Alert type='error'>{error}</Alert>
          )}
          {messageScope === 'password' && notice && (
            <Alert type='info'>{notice}</Alert>
          )}
        </NormalSection>
        {showCapacityModal && (
          <div
            className={styles.modalOverlay}
            role='presentation'
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !busy) {
                setShowCapacityModal(false);
              }
            }}
          >
            <div
              className={styles.modal}
              role='dialog'
              aria-modal='true'
              aria-labelledby='capacity-modal-title'
              onClick={(event) => event.stopPropagation()}
            >
              <h3 id='capacity-modal-title'>定員を変更</h3>
              <form onSubmit={saveCapacitySettings} className={styles.form}>
                <label>
                  {dashboard.kind === 'class' ? '全体定員' : '定員'}
                  <input
                    type='number'
                    min='1'
                    max='10000'
                    value={draftCapacity}
                    onInput={(event) =>
                      setDraftCapacity((event.target as HTMLInputElement).value)
                    }
                    required
                  />
                </label>
                <label>
                  中学生枠
                  <input
                    type='number'
                    min='0'
                    max={draftCapacity || '10000'}
                    value={draftJuniorCapacity}
                    onInput={(event) =>
                      setDraftJuniorCapacity(
                        (event.target as HTMLInputElement).value,
                      )
                    }
                    required
                  />
                </label>
                {dashboard.kind === 'class' && (
                  <label>
                    自クラスの発行可能枚数
                    <input
                      type='number'
                      min='0'
                      max='100'
                      value={draftClassTicketLimit}
                      onInput={(event) =>
                        setDraftClassTicketLimit(
                          (event.target as HTMLInputElement).value,
                        )
                      }
                      required
                    />
                  </label>
                )}
                {messageScope === 'ticketSettings' && error && (
                  <Alert type='error'>{error}</Alert>
                )}
                <div className={styles.modalActions}>
                  <button
                    type='button'
                    className={styles.modalCancel}
                    onClick={() => setShowCapacityModal(false)}
                    disabled={busy}
                  >
                    キャンセル
                  </button>
                  <button type='submit' disabled={busy}>
                    {busy ? '保存中...' : '保存'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {showGymTicketLimitModal && (
          <div
            className={styles.modalOverlay}
            role='presentation'
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !busy) {
                setShowGymTicketLimitModal(false);
              }
            }}
          >
            <div
              className={styles.modal}
              role='dialog'
              aria-modal='true'
              aria-labelledby='gym-ticket-limit-modal-title'
              onClick={(event) => event.stopPropagation()}
            >
              <h3 id='gym-ticket-limit-modal-title'>発行上限数を変更</h3>
              <form onSubmit={saveGymTicketLimit} className={styles.form}>
                <label>
                  自部活の体育館公演チケット発行上限
                  <input
                    type='number'
                    min='0'
                    max='100'
                    value={draftGymTicketLimit}
                    onInput={(event) =>
                      setDraftGymTicketLimit(
                        (event.target as HTMLInputElement).value,
                      )
                    }
                    required
                  />
                </label>
                {messageScope === 'ticketSettings' && error && (
                  <Alert type='error'>{error}</Alert>
                )}
                <div className={styles.modalActions}>
                  <button
                    type='button'
                    className={styles.modalCancel}
                    onClick={() => setShowGymTicketLimitModal(false)}
                    disabled={busy}
                  >
                    キャンセル
                  </button>
                  <button type='submit' disabled={busy}>
                    {busy ? '保存中...' : '保存'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {showMissingAffiliationModal && (
          <div
            className={styles.modalOverlay}
            role='presentation'
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setShowMissingAffiliationModal(false);
              }
            }}
          >
            <div
              className={styles.modal}
              role='dialog'
              aria-modal='true'
              aria-labelledby='missing-affiliation-modal-title'
              onClick={(event) => event.stopPropagation()}
            >
              <h3 id='missing-affiliation-modal-title'>
                名簿に未入力の項目があります
              </h3>
              {hasMissingAffiliation && (
                <p>学年・クラス・番号が未入力のチケットがあります。</p>
              )}
              {hasMissingName && <p>氏名管理に未登録の氏名があります。</p>}
              <p>
                該当する欄は空欄のままExcelを出力します。続行する場合は忘れずにExcelファイルを直接編集して氏名を入力してください。
              </p>
              <div className={styles.modalActions}>
                <button
                  type='button'
                  className={styles.modalCancel}
                  onClick={() => setShowMissingAffiliationModal(false)}
                >
                  キャンセル
                </button>
                <button
                  type='button'
                  onClick={() => {
                    setShowMissingAffiliationModal(false);
                    exportRoster();
                  }}
                >
                  続行して出力
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
export default OrganizationAdmin;
