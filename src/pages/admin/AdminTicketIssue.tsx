import { useEffect, useMemo, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import Alert from '../../components/ui/Alert';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import NormalSection from '../../components/ui/NormalSection';
import IssueStepPerformance from '../../features/issue/IssueStepPerformance';
import IssueStepTicketType from '../../features/issue/IssueStepTicketType';
import { useTitle } from '../../hooks/useTitle';
import { supabase } from '../../lib/supabase';
import {
  AdminAuthLayout,
  getSessionToken,
  readErrorMessage,
} from '../../layout/AdminAuthLayout';
import type {
  RelationshipRow,
  SelectedPerformance,
  TicketTypeOption,
} from '../../types/Issue.types';
import issueStyles from '../user/students/Issue.module.css';
import styles from './AdminTicketIssue.module.css';

type MasterData = {
  ticketTypes: TicketTypeOption[];
  relationships: RelationshipRow[];
};
const isAdmission = (type: TicketTypeOption | undefined) =>
  type?.name === '入場専用券';
const isUnsupportedRehearsalInvite = (type: TicketTypeOption) =>
  type.name === 'クラス公演(リハーサル)' && type.type === '招待券';

const AdminTicketIssueContent = () => {
  useTitle('新規チケット発券 - 管理画面');
  const { route } = useLocation();
  const [masters, setMasters] = useState<MasterData | null>(null);
  const [affiliation, setAffiliation] = useState('');
  const [ticketTypeId, setTicketTypeId] = useState<number>(1);
  const [relationshipId, setRelationshipId] = useState<number | null>(null);
  const [juniorRelationshipId, setJuniorRelationshipId] = useState<
    number | null
  >(null);
  const [selection, setSelection] = useState<SelectedPerformance>(null);
  const [count, setCount] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('admin-auth', {
          body: { action: 'getTicketManagementData' },
          headers: { 'x-admin-session-token': getSessionToken() ?? '' },
        });
        if (error) {
          throw error;
        }
        const raw = data as Omit<MasterData, 'ticketTypes'> & {
          ticketTypes: Array<Omit<TicketTypeOption, 'is_active'>>;
        };
        const loaded: MasterData = {
          ...raw,
          ticketTypes: raw.ticketTypes
            .filter(
              (type) => !isUnsupportedRehearsalInvite(type as TicketTypeOption),
            )
            .map((type) => ({ ...type, is_active: true })),
        };
        setMasters(loaded);
        const first = loaded.ticketTypes[0];
        if (first) {
          setTicketTypeId(first.id);
        }
      } catch (error) {
        setError(
          `発券設定の取得に失敗しました: ${await readErrorMessage(error)}`,
        );
      }
    };
    void load();
  }, []);

  const selectedType = useMemo(
    () => masters?.ticketTypes.find((type) => type.id === ticketTypeId),
    [masters, ticketTypeId],
  );
  const isGym = selectedType?.name.includes('体育館') ?? false;
  const admissionOnly = isAdmission(selectedType);
  const isJuniorTicket = selectedType?.type === '中学生券';
  const remainingMode =
    selectedType?.type === '中学生券'
      ? 'junior'
      : selectedType?.type === '当日券'
        ? 'total'
        : 'general';
  const selectedCellKey = selection
    ? `${selection.performanceId}-${selection.scheduleId}`
    : undefined;
  const canSubmit =
    /^\d{1,6}$/.test(affiliation) &&
    (isJuniorTicket
      ? juniorRelationshipId !== null
      : relationshipId !== null) &&
    (admissionOnly || selection !== null);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (!canSubmit || !selectedType) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke('admin-auth', {
        body: {
          action: 'adminIssueTickets',
          affiliation: Number(affiliation),
          ticketTypeId,
          relationshipId: relationshipId ?? 1,
          juniorRelationshipId,
          performanceId: admissionOnly ? 0 : selection?.performanceId,
          scheduleId: admissionOnly ? 0 : selection?.scheduleId,
          issueCount: count,
        },
        headers: { 'x-admin-session-token': getSessionToken() ?? '' },
      });
      if (error) {
        throw error;
      }
      const code = (
        data as { issuedTickets?: { code: string; signature: string }[] }
      ).issuedTickets?.[0];
      if (!code) {
        throw new Error('発券結果を取得できませんでした。');
      }
      route(`/t/${code.code}.${code.signature}`);
    } catch (error) {
      setError(`発券に失敗しました: ${await readErrorMessage(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (!masters) {
    return <LoadingSpinner message='発券設定を読み込んでいます...' />;
  }
  return (
    <div className={`${issueStyles.issuePage} ${styles.issuePage}`}>
      <Alert type='warning'>
        <p>管理者発券です。対象者と発券内容を確認してから実行してください。</p>
      </Alert>
      {error && (
        <Alert type='error'>
          <p>{error}</p>
        </Alert>
      )}
      <form className={styles.issueForm} onSubmit={submit}>
        <IssueStepTicketType
          options={masters.ticketTypes}
          selectedTicketTypeId={ticketTypeId}
          showType
          onSelectTicketType={(id) => {
            setTicketTypeId(id);
            setSelection(null);
            setJuniorRelationshipId(null);
          }}
        />
        {!admissionOnly && (
          <IssueStepPerformance
            isGymPerformanceTicket={isGym}
            selectedPerformance={selection}
            selectedCellKey={selectedCellKey}
            classRemainingMode={remainingMode}
            gymRemainingMode={remainingMode}
            onSelectPerformance={setSelection}
            allowClosedPerformances={true}
          />
        )}
        <NormalSection>
          <h2 className={issueStyles.sectionTitle}>
            {admissionOnly ? '2' : '3'}. 発券内容
          </h2>
          <div className={issueStyles.formRow}>
            <label
              className={issueStyles.formLabel}
              htmlFor='admin-affiliation'
            >
              学年1桁・クラス2桁・番号2桁（中学生は固有ID）
            </label>
            <input
              id='admin-affiliation'
              className={styles.input}
              inputMode='numeric'
              value={affiliation}
              onInput={(e) =>
                setAffiliation((e.target as HTMLInputElement).value)
              }
              placeholder='例：10101'
              required
            />
            <p>
              チケットに埋め込む、登録済みの利用者の
              利用者ID(学年1桁・クラス2桁・番号2桁、中学生は固有ID)
              を入力してください。
            </p>
          </div>
          {isJuniorTicket ? (
            <div className={issueStyles.formRow}>
              <label
                className={issueStyles.formLabel}
                htmlFor='admin-junior-relationship'
              >
                中学生券の利用者区分
              </label>
              <select
                id='admin-junior-relationship'
                className={issueStyles.select}
                value={juniorRelationshipId ?? ''}
                onChange={(e) =>
                  setJuniorRelationshipId(
                    Number((e.target as HTMLSelectElement).value),
                  )
                }
                required
              >
                <option value='' disabled>
                  選択してください
                </option>
                <option value='0'>中学生</option>
                <option value='1'>保護者</option>
                <option value='2'>中学生と保護者</option>
              </select>
            </div>
          ) : (
            <div className={issueStyles.formRow}>
              <label
                className={issueStyles.formLabel}
                htmlFor='admin-relationship'
              >
                招待券利用者との間柄
              </label>
              <select
                id='admin-relationship'
                className={issueStyles.select}
                value={relationshipId ?? ''}
                onChange={(e) =>
                  setRelationshipId(
                    Number((e.target as HTMLSelectElement).value) || null,
                  )
                }
                required
              >
                <option value='' disabled>
                  選択してください
                </option>
                {masters.relationships.map((relationship) => (
                  <option key={relationship.id} value={relationship.id}>
                    {relationship.name ?? `間柄${relationship.id}`}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className={issueStyles.formRow}>
            <label className={issueStyles.formLabel} htmlFor='admin-count'>
              発行枚数
            </label>
            <select
              id='admin-count'
              className={issueStyles.select}
              value={count}
              onChange={(e) =>
                setCount(Number((e.target as HTMLSelectElement).value))
              }
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}枚
                </option>
              ))}
            </select>
          </div>
          <h3 className={issueStyles.previewHeading}>発券内容</h3>
          <ul className={issueStyles.previewList}>
            <li>
              <span>利用者ID</span>
              <strong>{affiliation || '-'}</strong>
            </li>
            <li>
              <span>チケット種別</span>
              <strong>
                {selectedType
                  ? `${selectedType.name}${selectedType.type ? `（${selectedType.type}）` : ''}`
                  : '-'}
              </strong>
            </li>
            <li>
              <span>利用者区分</span>
              <strong>
                {isJuniorTicket
                  ? (['中学生', '保護者', '中学生と保護者'][
                      juniorRelationshipId ?? -1
                    ] ?? '-')
                  : (masters.relationships.find(
                      (item) => item.id === relationshipId,
                    )?.name ?? '-')}
              </strong>
            </li>
            <li>
              <span>公演</span>
              <strong>
                {admissionOnly
                  ? '入場専用'
                  : (selection?.performanceName ?? '-')}
              </strong>
            </li>
            <li>
              <span>公演回</span>
              <strong>
                {admissionOnly ? '-' : (selection?.scheduleName ?? '-')}
              </strong>
            </li>
            <li>
              <span>発行枚数</span>
              <strong>{count}枚</strong>
            </li>
          </ul>
        </NormalSection>
        <div className={`${issueStyles.actions} ${styles.actions}`}>
          <button
            type='submit'
            className={styles.submitButton}
            disabled={!canSubmit || submitting}
          >
            {submitting ? '発券中...' : 'この内容で発券する'}
          </button>
        </div>
      </form>
    </div>
  );
};
const AdminTicketIssue = () => (
  <AdminAuthLayout
    title='新規チケット発券'
    description='管理者権限でチケットを発券します。'
  >
    <AdminTicketIssueContent />
  </AdminAuthLayout>
);
export default AdminTicketIssue;
