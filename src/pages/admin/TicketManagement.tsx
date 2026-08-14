import { useEffect, useMemo, useState } from 'preact/hooks';
import Alert from '../../components/ui/Alert';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import NormalSection from '../../components/ui/NormalSection';
import { useTitle } from '../../hooks/useTitle';
import { supabase } from '../../lib/supabase';
import {
  AdminAuthLayout,
  getSessionToken,
  readErrorMessage,
} from '../../layout/AdminAuthLayout';
import styles from './TicketManagement.module.css';
import { applyDecodedSerials } from '../../features/tickets/decodeTicketSerial';
import { formatTicketCode } from '../../features/tickets/formatTicketCode';
import {
  downloadRosterXlsx,
  type RosterXlsxSheet,
  type RosterXlsxTicket,
} from '../../features/tickets/downloadRosterXlsx';

type Ticket = {
  id: string;
  code: string;
  signature: string;
  status: string;
  created_at: string;
  user_id: string;
  relationship: number;
  ticket_type: number;
  person_count: number;
  ticket_name?: string | null;
  serial?: number;
};
type Master = {
  id: number;
  name?: string;
  type?: string | null;
  class_name?: string;
  title?: string;
  round_name?: string;
  group_name?: string;
  start_at?: string | null;
  total_capacity?: number | null;
  capacity?: number | null;
  junior_capacity?: number | null;
};
type ManagementData = {
  tickets: Ticket[];
  users: { id: string; email: string; affiliation: number }[];
  relationships: Master[];
  ticketTypes: Master[];
  classTickets: { id: string; class_id: number; round_id: number }[];
  gymTickets: { id: string; performance_id: number }[];
  classes: Master[];
  schedules: Master[];
  gyms: Master[];
};

const statusLabel: Record<string, string> = {
  valid: '有効',
  used: '使用済み',
  cancelled: '取消済み',
};

const formatIssuedAt = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '-'
    : date.toLocaleString('ja-JP', {
        dateStyle: 'short',
        timeStyle: 'short',
      });
};

const normalizeTicketCodeForSearch = (value: string) =>
  value.replace(/-/g, '').toLowerCase();

type Roster = RosterXlsxSheet & {
  id: string;
};

const buildRosters = (data: ManagementData): Roster[] => {
  const users = new Map(data.users.map((user) => [user.id, user]));
  const classTickets = new Map(data.classTickets.map((ticket) => [ticket.id, ticket]));
  const gymTickets = new Map(data.gymTickets.map((ticket) => [ticket.id, ticket]));
  const validTickets = data.tickets.filter(
    (ticket) =>
      ticket.status === 'valid' &&
      ticket.ticket_type !== 5 &&
      ticket.ticket_type !== 6,
  );
  const createRosterTicket = (
    ticket: Ticket,
    roundId: number,
  ): RosterXlsxTicket => ({
    affiliation: users.get(ticket.user_id)?.affiliation ?? null,
    relationship: ticket.relationship,
    code: ticket.code,
    createdAt: ticket.created_at,
    roundId,
  });

  const classRosters = data.classes.map((performance) => {
    const performanceId = performance.id;
    return {
      id: `class:${performanceId}`,
      name: `${performance.class_name ?? ''} ${performance.title ?? ''}`.trim(),
      rounds: data.schedules.map((schedule) => ({
        id: schedule.id,
        name: schedule.round_name ?? '-',
      })),
      tickets: validTickets.flatMap((ticket) => {
        const link = classTickets.get(ticket.id);
        if (!link || link.class_id !== performanceId) {
          return [];
        }
        return [
          createRosterTicket(
            ticket,
            link.round_id,
          ),
        ];
      }),
      generalCapacity: Math.max(
        0,
        Number(performance.total_capacity ?? 0) -
          Number(performance.junior_capacity ?? 0),
      ),
    };
  });

  const gymGroups = new Map<string, Master[]>();
  data.gyms.forEach((performance) => {
    const groupName = performance.group_name ?? '-';
    gymGroups.set(groupName, [...(gymGroups.get(groupName) ?? []), performance]);
  });
  const gymRosters = [...gymGroups.entries()].map(([groupName, performances]) => {
    const performanceIds = new Set(performances.map((performance) => performance.id));
    return {
      id: `gym:${groupName}`,
      name: groupName,
      rounds: performances.map((performance) => ({
        id: performance.id,
        name: performance.round_name ?? '-',
      })),
      tickets: validTickets.flatMap((ticket) => {
        const link = gymTickets.get(ticket.id);
        if (!link || !performanceIds.has(link.performance_id)) {
          return [];
        }
        return [
          createRosterTicket(
            ticket,
            link.performance_id,
          ),
        ];
      }),
      generalCapacity: Math.max(
        0,
        ...performances.map((performance) =>
          Number(performance.capacity ?? 0) -
          Number(performance.junior_capacity ?? 0),
        ),
      ),
    };
  });

  return [
    ...classRosters.sort(
      (a, b) => Number(a.id.slice('class:'.length)) - Number(b.id.slice('class:'.length)),
    ),
    ...gymRosters.sort(
      (a, b) =>
        Math.min(...a.rounds.map((round) => round.id)) -
        Math.min(...b.rounds.map((round) => round.id)),
    ),
  ];
};

const TicketManagementContent = () => {
  useTitle('チケット管理 - 管理画面');
  const [data, setData] = useState<ManagementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{
    type: 'error' | 'info';
    text: string;
  } | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [affiliation, setAffiliation] = useState('');
  const [performance, setPerformance] = useState('');
  const [schedule, setSchedule] = useState('');
  const [status, setStatus] = useState('');
  const [ticketType, setTicketType] = useState('');
  const [ticketKind, setTicketKind] = useState('');
  const [cancellingCode, setCancellingCode] = useState<string | null>(null);
  const [selectedRosterId, setSelectedRosterId] = useState('');
  const [isExportingRoster, setIsExportingRoster] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data: response, error } = await supabase.functions.invoke(
        'admin-auth',
        {
          body: { action: 'getTicketManagementData' },
          headers: { 'x-admin-session-token': getSessionToken() ?? '' },
        },
      );
      if (error) {
        throw error;
      }
      const raw = response as ManagementData;
      setData({
        ...raw,
        tickets: await applyDecodedSerials(raw.tickets),
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text: `一覧の取得に失敗しました: ${await readErrorMessage(error)}`,
      });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo(() => {
    if (!data) {
      return [];
    }
    const users = new Map(data.users.map((item) => [item.id, item]));
    const relationships = new Map(
      data.relationships.map((item) => [item.id, item.name ?? '-']),
    );
    const ticketKinds = new Map(
      data.ticketTypes.map((item) => [
        item.id,
        (item.name ?? '-').replace(/\([^)]*\)/g, ''),
      ]),
    );
    const ticketTypes = new Map(
      data.ticketTypes.map((item) => [item.id, item.type ?? '-']),
    );
    const classes = new Map(
      data.classes.map((item) => [
        item.id,
        `${item.class_name ?? ''}${item.title ? `：${item.title}` : ''}`,
      ]),
    );
    const schedules = new Map(
      data.schedules.map((item) => [item.id, item.round_name ?? '-']),
    );
    const gyms = new Map(data.gyms.map((item) => [item.id, item]));
    const classTickets = new Map(
      data.classTickets.map((item) => [item.id, item]),
    );
    const gymTickets = new Map(data.gymTickets.map((item) => [item.id, item]));
    const normalizedCode = normalizeTicketCodeForSearch(code);
    return data.tickets
      .map((ticket) => {
        const owner = users.get(ticket.user_id);
        const classTicket = classTickets.get(ticket.id);
        const gymTicket = gymTickets.get(ticket.id);
        const performance = classTicket
          ? (classes.get(classTicket.class_id) ?? '-')
          : gymTicket
            ? (gyms.get(gymTicket.performance_id)?.group_name ?? '-')
            : '入場専用';
        const schedule = classTicket
          ? (schedules.get(classTicket.round_id) ?? '-')
          : gymTicket
            ? (gyms.get(gymTicket.performance_id)?.round_name ?? '-')
            : '-';
        const displayName =
          ticket.ticket_name?.trim() ||
          [
            performance,
            schedule,
            typeof ticket.serial === 'number' ? `#${ticket.serial}` : '',
          ]
            .filter(Boolean)
            .join(' ');
        return {
          ticket,
          owner,
          displayName,
          relationship: relationships.get(ticket.relationship) ?? '-',
          ticketKind: ticketKinds.get(ticket.ticket_type) ?? '-',
          ticketType: ticketTypes.get(ticket.ticket_type) ?? '-',
          performance,
          schedule,
        };
      })
      .filter((row) => {
        const allName = row.displayName.toLowerCase();
        return (
          (!normalizedCode ||
            normalizeTicketCodeForSearch(row.ticket.code).includes(normalizedCode)) &&
          (!name || allName.includes(name.toLowerCase())) &&
          (!affiliation ||
            String(row.owner?.affiliation ?? '').includes(affiliation)) &&
          (!performance || row.performance === performance) &&
          (!schedule || row.schedule === schedule) &&
          (!status || row.ticket.status === status) &&
          (!ticketType || row.ticketType === ticketType) &&
          (!ticketKind || row.ticketKind === ticketKind)
        );
      });
  }, [
    data,
    code,
    name,
    affiliation,
    performance,
    schedule,
    status,
    ticketType,
    ticketKind,
  ]);

  const cancel = async (ticket: Ticket) => {
    if (
      !window.confirm(
        `${ticket.code} を取り消しますか？この操作は元に戻せません。`,
      )
    ) {
      return;
    }
    setCancellingCode(ticket.code);
    setMessage(null);
    try {
      const { error } = await supabase.functions.invoke('admin-auth', {
        body: { action: 'cancelTicket', code: ticket.code },
        headers: { 'x-admin-session-token': getSessionToken() ?? '' },
      });
      if (error) {
        throw error;
      }
      setData(
        (current) =>
          current && {
            ...current,
            tickets: current.tickets.map((item) =>
              item.code === ticket.code
                ? { ...item, status: 'cancelled' }
                : item,
            ),
        },
      );
      setMessage({ type: 'info', text: 'チケットを取り消しました。' });
    } catch (error) {
      setMessage({
        type: 'error',
        text: `取消に失敗しました: ${await readErrorMessage(error)}`,
      });
    } finally {
      setCancellingCode(null);
    }
  };
  const reset = () => {
    setCode('');
    setName('');
    setAffiliation('');
    setPerformance('');
    setSchedule('');
    setStatus('');
    setTicketType('');
    setTicketKind('');
  };
  const performanceOptions = [
    ...new Set([
      ...(data?.classes ?? []).map(
        (item) => `${item.class_name ?? ''}${item.title ? `：${item.title}` : ''}`,
      ),
      ...(data?.gyms ?? []).map((item) => item.group_name ?? '-'),
      '入場専用',
    ]),
  ].sort();
  const scheduleOptions = [
    ...new Set([
      ...(data?.schedules ?? []).map((item) => item.round_name ?? '-'),
      ...(data?.gyms ?? []).map((item) => item.round_name ?? '-'),
      '-',
    ]),
  ].sort();
  const ticketTypeOptions = [
    ...new Set((data?.tickets ?? []).map((ticket) => {
      const master = data?.ticketTypes.find((item) => item.id === ticket.ticket_type);
      return master?.type ?? '-';
    })),
  ].sort();
  const ticketKindOptions = [
    ...new Set((data?.tickets ?? []).map((ticket) => {
      const master = data?.ticketTypes.find((item) => item.id === ticket.ticket_type);
      return (master?.name ?? '-').replace(/\([^)]*\)/g, '');
    })),
  ].sort();
  const rosters = useMemo(
    () => (data ? buildRosters(data) : []),
    [data],
  );

  const downloadRosters = async (targets: Roster[]) => {
    if (targets.length === 0) {
      setMessage({ type: 'error', text: '出力できるクラス・部活がありません。' });
      return;
    }
    setIsExportingRoster(true);
    setMessage(null);
    try {
      const date = new Date();
      const dateText = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      await downloadRosterXlsx({
        rosters: targets,
        relationships: (data?.relationships ?? []).map((relationship) => ({
          id: relationship.id,
          name: relationship.name ?? '—',
        })),
        filename: `招待者名簿_${targets.length === 1 ? targets[0].name : '一括'}_${dateText}.xlsx`,
      });
      setMessage({ type: 'info', text: '招待者名簿を出力しました。' });
    } catch (error) {
      setMessage({
        type: 'error',
        text: `招待者名簿の出力に失敗しました: ${await readErrorMessage(error)}`,
      });
    } finally {
      setIsExportingRoster(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message='チケット一覧を読み込んでいます...' />;
  }
  return (
    <>
      <div className={styles.header}>
        <button type='button' onClick={() => void load()}>
          更新
        </button>
      </div>
      {message && <Alert type={message.type}>{message.text}</Alert>}
      <NormalSection>
        <div className={styles.sectionHeading}>
          <div>
            <h2>新規チケット発券</h2>
            <p>管理者権限で、対象の 利用者ID を指定して発券できます。</p>
          </div>
          <a className={styles.issueButton} href='/admin/tickets/issue'>
            新規チケットを発券
          </a>
        </div>
      </NormalSection>
      <NormalSection>
        <div className={styles.sectionHeading}>
          <div>
            <h2>ステータス</h2>
            <p>チケット発券状況はこちら</p>
          </div>
          <a className={styles.issueButton} href='/admin/status'>
            ステータス画面を開く
          </a>
        </div>
      </NormalSection>
      <NormalSection>
        <div className={styles.sectionHeading}>
          <div>
            <h2>招待者名簿</h2>
            <p>クラス・部活ごとの招待者名簿をExcel形式で出力します。</p>
          </div>
        </div>
        <div className={styles.rosterExportControls}>
          <label>
            クラス・部活
            <select
              value={selectedRosterId}
              onChange={(event) =>
                setSelectedRosterId(
                  (event.target as HTMLSelectElement).value,
                )
              }
              disabled={isExportingRoster}
            >
              <option value=''>選択してください</option>
              <option value='all'>すべて（複数シート）</option>
              {rosters.map((roster) => (
                <option key={roster.id} value={roster.id}>
                  {roster.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type='button'
            className={styles.issueButton}
            disabled={
              isExportingRoster ||
              (selectedRosterId !== 'all' &&
                !rosters.some((roster) => roster.id === selectedRosterId))
            }
            onClick={() => {
              if (selectedRosterId === 'all') {
                void downloadRosters(rosters);
                return;
              }
              const roster = rosters.find(
                (item) => item.id === selectedRosterId,
              );
              if (roster) {
                void downloadRosters([roster]);
              }
            }}
          >
            {isExportingRoster ? '出力中…' : '招待者名簿を出力'}
          </button>
        </div>
      </NormalSection>
      <NormalSection>
        <h2>チケット一覧</h2>
        <div className={styles.filters}>
          <label>
            チケットコード
            <input
              value={code}
              onInput={(e) => setCode((e.target as HTMLInputElement).value)}
              placeholder='コードの一部でも可'
            />
          </label>
          <label>
            チケット名
            <input
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              placeholder='チケット名'
            />
          </label>
          <label>
            利用者ID（学年1桁・クラス2桁・番号2桁、中学生は固有ID）
            <input
              value={affiliation}
              inputMode='numeric'
              onInput={(e) =>
                setAffiliation((e.target as HTMLInputElement).value)
              }
              placeholder='例：10101'
            />
          </label>
          <label>
            公演
            <select
              value={performance}
              onChange={(e) =>
                setPerformance((e.target as HTMLSelectElement).value)
              }
            >
              <option value=''>すべて</option>
              {performanceOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            公演回
            <select
              value={schedule}
              onChange={(e) =>
                setSchedule((e.target as HTMLSelectElement).value)
              }
            >
              <option value=''>すべて</option>
              {scheduleOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            状態
            <select
              value={status}
              onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}
            >
              <option value=''>すべて</option>
              {Object.entries(statusLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            チケットタイプ
            <select
              value={ticketType}
              onChange={(e) =>
                setTicketType((e.target as HTMLSelectElement).value)
              }
            >
              <option value=''>すべて</option>
              {ticketTypeOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            チケット種別
            <select
              value={ticketKind}
              onChange={(e) =>
                setTicketKind((e.target as HTMLSelectElement).value)
              }
            >
              <option value=''>すべて</option>
              {ticketKindOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button type='button' className={styles.clearButton} onClick={reset}>
            絞り込みを解除
          </button>
        </div>
        <p className={styles.resultCount}>{rows.length} 件を表示</p>
        <p className={styles.tableScrollHint}>
          ← 横にスクロールできます →
        </p>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>状態</th>
                <th>チケットコード</th>
                <th>名前</th>
                <th>利用者ID</th>
                <th>公演</th>
                <th>回</th>
                <th>間柄</th>
                <th>チケットタイプ</th>
                <th>チケット種別</th>
                <th>人数</th>
                <th>発行日時</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.ticket.code}>
                  <td>
                    <span
                      className={`${styles.status} ${styles[row.ticket.status] ?? ''}`}
                    >
                      {statusLabel[row.ticket.status] ?? row.ticket.status}
                    </span>
                  </td>
                  <td className={styles.code}>
                    {formatTicketCode(row.ticket.code)}
                  </td>
                  <td>
                    {row.displayName}
                  </td>
                  <td>{row.owner?.affiliation ?? '-'}</td>
                  <td>
                    {row.performance}
                  </td>
                  <td>{row.schedule}</td>
                  <td>{row.relationship}</td>
                  <td>
                    {row.ticketType}
                  </td>
                  <td>
                    {row.ticketKind}
                  </td>
                  <td>{row.ticket.person_count} 人分</td>
                  <td>{formatIssuedAt(row.ticket.created_at)}</td>
                  <td>
                    <div className={styles.actions}>
                      <a
                        href={`/t/${row.ticket.code}.${row.ticket.signature}`}
                        target='_blank'
                        rel='noreferrer'
                      >
                        チケットページ
                      </a>
                      {row.ticket.status === 'valid' && (
                        <button
                          type='button'
                          className={styles.cancelButton}
                          disabled={cancellingCode === row.ticket.code}
                          onClick={() => void cancel(row.ticket)}
                        >
                          {cancellingCode === row.ticket.code
                            ? '取消中…'
                            : '取消'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={13} className={styles.empty}>
                    該当するチケットはありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </NormalSection>
    </>
  );
};

const TicketManagement = () => (
  <AdminAuthLayout
    title='チケット管理'
    description='発券済みチケットの検索・確認・管理を行います。'
  >
    <TicketManagementContent />
  </AdminAuthLayout>
);
export default TicketManagement;
