import GymPerformancesTable from '../../features/performances/GymPerformancesTable';
import PerformancesTable from '../../features/performances/PerformancesTable';
import type { RemainingMode } from '../../features/performances/availabilityHelpers';
import { useState } from 'preact/hooks';
import { useTitle } from '../../hooks/useTitle';
import styles from '../../styles/sub-pages.module.css';
import NormalSection from '../../components/ui/NormalSection';
import pageStyles from './Availability.module.css';
import Modal2 from '../../components/ui/Modal2';

const Availability = () => {
  const [remainingMode, setRemainingMode] = useState<RemainingMode | null>(
    null,
  );
  useTitle('公演空き状況');

  const selectRemainingMode = (mode: RemainingMode) => {
    setRemainingMode(mode);
  };

  return (
    <>
      <Modal2 />
      <h1 className={styles.pageTitle}>公演空き状況</h1>
      <p className={pageStyles.introduction}>
        残席はキャンセルなどにより変動します。最新の状況をご確認ください。
      </p>
      <nav className={styles.pageNavigation} aria-label='関連ページ'>
        <a className={styles.openButton} href='/performances'>
          演目一覧を見る
        </a>
        <a className={styles.openButton} href='/timetable'>
          タイムテーブルを見る
        </a>
      </nav>

      {remainingMode !== null ? (
        <>
          <NormalSection>
            <h2>クラス公演</h2>
            <p className={pageStyles.description}>
              クラスと公演回を選んで、各公演の空き状況を確認できます。
            </p>
            <PerformancesTable
              remainingMode={remainingMode}
              showToggleRemainingMode={true}
            />
          </NormalSection>

          <NormalSection>
            <h2>体育館公演</h2>
            <p className={pageStyles.description}>
              団体と公演回を選んで、各公演の空き状況を確認できます。
            </p>
            <GymPerformancesTable
              remainingMode={remainingMode}
              showToggleRemainingMode={true}
            />
          </NormalSection>
        </>
      ) : null}

      {remainingMode === null ? (
        <div className={pageStyles.modeModalOverlay}>
          <section
            className={pageStyles.modeModal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='availability-mode-title'
          >
            <h2 id='availability-mode-title'>どの枠の空き状況を見ますか？</h2>
            <div className={pageStyles.modeModalActions}>
              <button
                type='button'
                onClick={() => selectRemainingMode('general')}
              >
                招待券枠
              </button>
              <button
                type='button'
                onClick={() => selectRemainingMode('junior')}
              >
                中学生枠
              </button>
              <button
                type='button'
                onClick={() => selectRemainingMode('total')}
              >
                招待券・中学生枠
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
};

export default Availability;
