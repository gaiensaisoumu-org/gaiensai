import NormalSection from '../../components/ui/NormalSection';
import styles from '../../pages/user/students/Issue.module.css';
import type {
  RelationshipRow,
  SelectedPerformance,
  TicketTypeOption,
} from '../../types/Issue.types';

type IssueStepDetailsProps = {
  relationships: RelationshipRow[];
  relationshipLoading: boolean;
  relationshipError: string | null;
  selectedRelationshipId: number | null;
  issueCount: number;
  maxIssueCount: number;
  selectedTicketType: TicketTypeOption | null;
  selectedPerformance: SelectedPerformance;
  hideRelationship?: boolean;
  onSelectRelationshipId: (relationshipId: number | null) => void;
  onSelectIssueCount: (count: number) => void;
};

const IssueStepDetails = ({
  relationships,
  relationshipLoading,
  relationshipError,
  selectedRelationshipId,
  issueCount,
  maxIssueCount,
  selectedTicketType,
  selectedPerformance,
  hideRelationship = false,
  onSelectRelationshipId,
  onSelectIssueCount,
}: IssueStepDetailsProps) => {
  return (
    <NormalSection>
      <h2 className={styles.sectionTitle}>
        3. {hideRelationship ? '発行枚数' : '間柄と発行枚数'}
      </h2>
      {!hideRelationship && (
        <div className={styles.formRow}>
          <label className={styles.formLabel} htmlFor='relationship'>
            招待券利用者との間柄
          </label>
          <select
            id='relationship'
            className={styles.select}
            value={
              selectedRelationshipId === null
                ? ''
                : String(selectedRelationshipId)
            }
            onChange={(event) => {
              const value = event.currentTarget.value;
              onSelectRelationshipId(value ? Number(value) : null);
            }}
            disabled={relationshipLoading}
          >
            <option value='' selected disabled hidden>
              {relationshipLoading
                ? '読み込み中...'
                : (relationshipError ?? '選択してください')}
            </option>
            {relationships.map((relationship) => (
              <option key={relationship.id} value={relationship.id}>
                {relationship.name ?? `間柄${relationship.id}`}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className={styles.formRow}>
        <label className={styles.formLabel} htmlFor='issue-count'>
          発行枚数
        </label>
        <p style={{ margin: 0, paddingLeft: '1em' }}>
          この枚数分だけ、1人分のチケットが同時に発券されます。
        </p>
        <select
          id='issue-count'
          className={styles.select}
          value={String(issueCount)}
          onChange={(event) =>
            onSelectIssueCount(Number(event.currentTarget.value))
          }
        >
          {Array.from({ length: maxIssueCount }, (_, index) => index + 1).map(
            (count) => (
              <option key={count} value={count}>
                {count}枚
              </option>
            ),
          )}
        </select>
      </div>

      <h3 className={styles.previewHeading}>発券内容</h3>
      <ul className={styles.previewList}>
        {!hideRelationship && (
          <li>
            <span>チケットタイプ</span>
            <strong>{selectedTicketType?.name ?? '-'}</strong>
          </li>
        )}
        <li>
          <span>公演のクラス</span>
          <strong>
            {selectedPerformance ? selectedPerformance.performanceName : '-'}
          </strong>
        </li>
        <li>
          <span>公演回</span>
          <strong>
            {selectedPerformance ? selectedPerformance.scheduleName : '-'}
          </strong>
        </li>
        <li>
          <span>利用者との間柄</span>
          <strong>
            {selectedRelationshipId === null
              ? '-'
              : (relationships.find(
                  (relationship) => relationship.id === selectedRelationshipId,
                )?.name ?? '-')}
          </strong>
        </li>
        <li>
          <span>発行枚数</span>
          <strong>{issueCount}枚</strong>
        </li>
      </ul>
    </NormalSection>
  );
};

export default IssueStepDetails;
