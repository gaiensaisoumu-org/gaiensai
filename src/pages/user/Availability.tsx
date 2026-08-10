import GymPerformancesTable from '../../features/performances/GymPerformancesTable';
import PerformancesTable from '../../features/performances/PerformancesTable';
import { useTitle } from '../../hooks/useTitle';
import styles from '../../styles/sub-pages.module.css';
import NormalSection from '../../components/ui/NormalSection';
import pageStyles from './Availability.module.css';
import Modal2 from '../../components/ui/Modal2';

const Availability = () => {
  useTitle('公演空き状況');

  return (
    <>
      <Modal2 />
      <h1 className={styles.pageTitle}>公演空き状況</h1>
      <p className={pageStyles.introduction}>
        残席はキャンセルなどにより変動します。最新の状況をご確認ください。
      </p>
      <nav className={styles.pageNavigation} aria-label='関連ページ'>
        <a className={styles.openButton} href='/performances'>
          公演一覧を見る
        </a>
        <a className={styles.openButton} href='/timetable'>
          タイムテーブルを見る
        </a>
      </nav>

      <NormalSection>
        <h2>クラス公演</h2>
        <p className={pageStyles.description}>
          クラスと公演回を選んで、各公演の空き状況を確認できます。
        </p>
        <PerformancesTable
          remainingMode='total'
          showToggleRemainingMode={true}
        />
      </NormalSection>

      <NormalSection>
        <h2>体育館公演</h2>
        <p className={pageStyles.description}>
          団体と公演回を選んで、各公演の空き状況を確認できます。
        </p>
        <GymPerformancesTable
          remainingMode='total'
          showToggleRemainingMode={true}
        />
      </NormalSection>
    </>
  );
};

export default Availability;
