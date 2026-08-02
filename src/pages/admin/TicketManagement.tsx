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
          (!code ||
            row.ticket.code.toLowerCase().includes(code.toLowerCase())) &&
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
                  <td className={styles.code}>{row.ticket.code}</td>
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
                  <td colSpan={12} className={styles.empty}>
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
