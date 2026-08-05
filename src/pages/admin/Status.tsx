import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import Alert from '../../components/ui/Alert';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import NormalSection from '../../components/ui/NormalSection';
import GymPerformancesTable from '../../features/performances/GymPerformancesTable';
import PerformancesTable from '../../features/performances/PerformancesTable';
import { useTitle } from '../../hooks/useTitle';
import {
  AdminAuthLayout,
  getSessionToken,
  readErrorMessage,
} from '../../layout/AdminAuthLayout';
import { supabase } from '../../lib/supabase';
import styles from './Status.module.css';

type Row = {
  name: string;
  account_count?: number;
  initial_count?: number;
  ticket_count: number;
  visitor_count: number;
};

type DistributionRow = { name: string; value: number };

type JuniorStatus = {
  registeredCount: number;
  admissionOnlyCount: number;
  reservationEligibleCount: number;
  bookedJuniorCount: number;
  nextAffiliation: number;
  separateOnRegistrationCount: number;
  laterSplitCount: number;
  usageTypes: DistributionRow[];
  applicationDays: DistributionRow[];
};

type Dashboard = {
  overview: {
    studentAccounts: number;
    initialRegistrations: number;
    juniorRegistrations: number;
    issuedTickets: number;
    validTickets: number;
    validVisitors: number;
    cancelledTickets: number;
  };
  classes: Row[];
  clubs: Row[];
  juniorStatus: JuniorStatus;
  rankings: {
    performances: Row[];
    ticketPerformances: Row[];
    gymPerformances: Row[];
    times: Row[];
    relationships: Row[];
    ticketTypes: Row[];
  };
};

const COLORS = ['#ff8a65', '#4db6ac', '#7986cb', '#ffb74d', '#9575cd', '#81c784', '#e57373'];
const number = (value: number | undefined) => (value ?? 0).toLocaleString('ja-JP');

const Ranking = ({ title, rows }: { title: string; rows: Row[] }) => (
  <section className={styles.ranking}>
    <h3>{title}</h3>
    {rows.length === 0 ? (
      <p className={styles.empty}>まだデータがありません。</p>
    ) : (
      <ol className={styles.rankingList}>
        {rows.map((row, index) => (
          <li key={row.name}>
            <span className={styles.rank}>{index + 1}</span>
            <span className={styles.rankName}>{row.name}</span>
            <span className={styles.rankValue}>
              {number(row.ticket_count)} 枚
              <small>{number(row.visitor_count)} 人分</small>
            </span>
          </li>
        ))}
      </ol>
    )}
  </section>
);

const DistributionChart = ({ title, rows }: { title: string; rows: DistributionRow[] }) => (
  <section className={styles.distribution}>
    <h3>{title}</h3>
    {rows.length === 0 ? <p className={styles.empty}>まだデータがありません。</p> : (
      <ResponsiveContainer width='100%' height={260}>
        <PieChart>
          <Pie data={rows} dataKey='value' nameKey='name' cx='50%' cy='50%' outerRadius={88} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
            {rows.map((row, index) => <Cell key={row.name} fill={COLORS[index % COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(value) => `${number(Number(value))} 人`} />
        </PieChart>
      </ResponsiveContainer>
    )}
  </section>
);

const StatusContent = () => {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useTitle('ステータス - 管理画面');

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        'admin-auth',
        {
          body: { action: 'getStatusDashboard' },
          headers: { 'x-admin-session-token': getSessionToken() ?? '' },
        },
      );
      if (invokeError) {
        throw invokeError;
      }
      if (!data?.dashboard) {
        throw new Error('集計データを取得できませんでした。');
      }
      setDashboard(data.dashboard as Dashboard);
    } catch (loadError) {
      setError(`集計の取得に失敗しました。${await readErrorMessage(loadError)}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const registrationPie = useMemo(() => {
    if (!dashboard) {
      return [];
    }
    return dashboard.classes
      .filter((row) => (row.account_count ?? 0) > 0)
      .map((row) => ({
        name: row.name,
        value: Math.round(((row.initial_count ?? 0) / (row.account_count ?? 1)) * 1000) / 10,
      }));
  }, [dashboard]);

  const juniorReservationPie = useMemo(() => {
    if (!dashboard) {
      return [];
    }
    const { reservationEligibleCount, bookedJuniorCount } = dashboard.juniorStatus;
    return [
      { name: '予約済み', value: bookedJuniorCount },
      { name: '未予約', value: Math.max(reservationEligibleCount - bookedJuniorCount, 0) },
    ];
  }, [dashboard]);

  if (isLoading) {
    return <LoadingSpinner message='ステータスを集計しています...' />;
  }

  if (error || !dashboard) {
    return (
      <>
        <Alert type='error'>{error ?? '集計データを取得できませんでした。'}</Alert>
        <button type='button' className={styles.refreshButton} onClick={() => void load()}>
          再読み込み
        </button>
      </>
    );
  }

  const { overview } = dashboard;
  const { juniorStatus } = dashboard;
  return (
    <div className={styles.pageShell}>
      <div className={styles.headerRow}>
        <div>
          <p className={styles.lead}>
            発券済みは有効チケット、人数はチケットの利用人数合計です。
          </p>
        </div>
        <button
          type='button'
          className={styles.refreshButton}
          onClick={() => void load()}
        >
          更新
        </button>
      </div>

      <NormalSection>
        <div className={styles.headerRow}>
          <div>
            <h2>コントロールパネル</h2>
            <p className={styles.settingHint}>
              種々の設定の変更はこちら
            </p>
          </div>
          <a className={styles.inlineEditButton} href='/admin/settings'>
            コントロールパネルを開く
          </a>
        </div>
      </NormalSection>

      <div className={styles.cards}>
        <div>
          <span>生徒アカウント</span>
          <strong>{number(overview.studentAccounts)}</strong>初回登録済{' '}
          {number(overview.initialRegistrations)}
        </div>
        <div>
          <span>中学生登録</span>
          <strong>{number(overview.juniorRegistrations)}</strong>
          <small>アカウント</small>
        </div>
        <div>
          <span>発券総数</span>
          <strong>{number(overview.issuedTickets)}</strong>
          取消 {number(overview.cancelledTickets)}
        </div>
        <div>
          <span>有効チケット</span>
          <strong>{number(overview.validTickets)}</strong>
          <small>{number(overview.validVisitors)} 人分</small>
        </div>
      </div>

      <NormalSection>
        <h2>初回登録状況（クラス別）</h2>
        <div className={styles.registrationGrid}>
          <div className={styles.chart}>
            <ResponsiveContainer width='100%' height={310}>
              <PieChart>
                <Pie
                  data={registrationPie}
                  dataKey='value'
                  nameKey='name'
                  cx='50%'
                  cy='50%'
                  outerRadius={110}
                  label={({ name, value }) => `${name} ${value}%`}
                >
                  {registrationPie.map((row, index) => (
                    <Cell key={row.name} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `${value}%`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div>
            <p className={styles.tableScrollHint}>
              ← 横にスクロールできます →
            </p>
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>クラス</th>
                    <th>初回登録</th>
                    <th>登録率</th>
                    <th>発券</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.classes.map((row) => {
                    const total = row.account_count ?? 0;
                    const rate = total
                      ? ((row.initial_count ?? 0) / total) * 100
                      : 0;
                    return (
                      <tr key={row.name}>
                        <th>{row.name}</th>
                        <td>
                          {number(row.initial_count)} / {number(total)}
                        </td>
                        <td>{rate.toFixed(1)}%</td>
                        <td>{number(row.ticket_count)} 枚</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </NormalSection>

      <NormalSection>
        <h2>部活別の発券状況</h2>
        <p className={styles.tableScrollHint}>
          ← 横にスクロールできます →
        </p>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>部活</th>
                <th>登録者</th>
                <th>有効チケット</th>
                <th>人数分</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.clubs.map((row) => (
                <tr key={row.name}>
                  <th>{row.name}</th>
                  <td>{number(row.account_count)}</td>
                  <td>{number(row.ticket_count)} 枚</td>
                  <td>{number(row.visitor_count)} 人分</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </NormalSection>

      <NormalSection>
        <h2>中学生の発券状況</h2>
        <div className={styles.juniorCards}>
          <div>
            <span>登録数</span>
            <strong>{number(juniorStatus.registeredCount)}</strong>
          </div>
          <div>
            <span>入場専用のみ</span>
            <strong>{number(juniorStatus.admissionOnlyCount)}</strong>
          </div>
          <div>
            <span>予約済み中学生</span>
            <strong>
              {number(juniorStatus.bookedJuniorCount)} /{' '}
              {number(juniorStatus.reservationEligibleCount)}
            </strong>
            <small>入場専用のみを除く登録数に対して</small>
          </div>
          <div>
            <span>次の affiliation</span>
            <strong>{number(juniorStatus.nextAffiliation)}</strong>
          </div>
          <div>
            <span>登録時に別々のアカウント</span>
            <strong>{number(juniorStatus.separateOnRegistrationCount)}</strong>
            <small>カウンター開始以降</small>
          </div>
          <div>
            <span>後からアカウントを分割</span>
            <strong>{number(juniorStatus.laterSplitCount)}</strong>
            <small>カウンター開始以降</small>
          </div>
        </div>
        <div className={styles.distributions}>
          <DistributionChart
            title='利用形態の割合'
            rows={juniorStatus.usageTypes}
          />
          <DistributionChart
            title='申込日の割合'
            rows={juniorStatus.applicationDays}
          />
          <DistributionChart
            title='チケット予約率'
            rows={juniorReservationPie}
          />
        </div>
      </NormalSection>

      <NormalSection>
        <h2>公演空き状況</h2>
        <p className={styles.lead}>表示する残席の種類を切り替えられます。</p>
        <h3 className={styles.subheading}>クラス公演</h3>
        <PerformancesTable showToggleRemainingMode={true} />
        <h3 className={styles.subheading}>体育館公演</h3>
        <GymPerformancesTable showToggleRemainingMode={true} />
      </NormalSection>

      <NormalSection>
        <h2>発券ランキング</h2>
        <p className={styles.lead}>
          有効なチケットを、チケット枚数順に表示しています。
        </p>
        <div className={styles.rankings}>
          <Ranking
            title='公演（全種類）'
            rows={dashboard.rankings.performances}
          />
          <Ranking
            title='チケットのクラス公演先'
            rows={dashboard.rankings.ticketPerformances}
          />
          <Ranking
            title='チケットの部活公演先'
            rows={dashboard.rankings.gymPerformances}
          />
          <Ranking title='公演時間' rows={dashboard.rankings.times} />
          <Ranking title='間柄' rows={dashboard.rankings.relationships} />
          <Ranking title='チケット種類' rows={dashboard.rankings.ticketTypes} />
        </div>
      </NormalSection>
    </div>
  );
};

const Status = () => (
  <AdminAuthLayout title='ステータス' description='初回登録・発券状況を確認できます。'>
    <StatusContent />
  </AdminAuthLayout>
);

export default Status;
