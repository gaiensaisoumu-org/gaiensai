import NormalSection from '../../components/ui/NormalSection';
import type { TicketTypeOption } from '../../types/Issue.types';
import styles from '../../pages/user/students/Issue.module.css';

type IssueStepTicketTypeProps = {
  options: TicketTypeOption[];
  selectedTicketTypeId: number;
  showType?: boolean;
  onSelectTicketType: (ticketTypeId: number) => void;
};

const IssueStepTicketType = ({
  options,
  selectedTicketTypeId,
  showType = false,
  onSelectTicketType,
}: IssueStepTicketTypeProps) => {
  return (
    <NormalSection>
      <h2 className={styles.sectionTitle}>1. チケットの種類を選択</h2>
      <div className={styles.ticketTypeGrid}>
        {options.map((option) => {
          const isSelected = selectedTicketTypeId === option.id;

          return (
            <label
              key={option.id}
              className={`${styles.ticketTypeButton} ${
                isSelected ? styles.ticketTypeButtonSelected : ''
              }`}
            >
              <input
                type='radio'
                name='ticket_type'
                value={String(option.id)}
                checked={isSelected}
                disabled={!option.is_active}
                onChange={() => onSelectTicketType(option.id)}
                className={styles.srOnly}
              />
              {option.name}
              {showType && option.type ? `（${option.type}）` : ''}
            </label>
          );
        })}
      </div>
    </NormalSection>
  );
};

export default IssueStepTicketType;
