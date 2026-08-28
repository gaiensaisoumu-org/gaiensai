import { useState } from 'preact/hooks';
import PerformancesTable from '../../features/performances/PerformancesTable';
import QRCode from '../../components/ui/QRCode';
import styles from './Availability.module.css';

const grades = ['1', '2', '3'] as const;

const Availability = () => {
  const [gradeFilters, setGradeFilters] = useState<Array<'1' | '2' | '3'>>([
    '1',
    '2',
    '3',
  ]);
  const [dayFilters, setDayFilters] = useState<Array<'1' | '2'>>(['1', '2']);

  const toggleGrade = (grade: '1' | '2' | '3') => {
    setGradeFilters((current) =>
      current.includes(grade)
        ? current.filter((item) => item !== grade)
        : [...current, grade],
    );
  };
  const toggleDay = (day: '1' | '2') => {
    setDayFilters((current) =>
      current.includes(day)
        ? current.filter((item) => item !== day)
        : [...current, day],
    );
  };

  return (
    <>
      <header className={styles.header}>
        <h1>公演空き状況</h1>
        <div className={styles.filters} aria-label='表示対象の絞り込み'>
          <fieldset>
            <legend>学年</legend>
            {grades.map((grade) => (
              <label key={grade}>
                <input
                  type='checkbox'
                  checked={gradeFilters.includes(grade)}
                  onChange={() => toggleGrade(grade)}
                />
                {grade}年
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>日付</legend>
            {(['1', '2'] as const).map((day) => (
              <label key={day}>
                <input
                  type='checkbox'
                  checked={dayFilters.includes(day)}
                  onChange={() => toggleDay(day)}
                />
                {day}日目
              </label>
            ))}
          </fieldset>
        </div>
        <aside className={styles.guide}>
          <div>
            <h3 style={{margin: '0.5em 0'}}>他のクラス・日はこちら</h3>
            <a href='https://gaiensai.com/availability'>
              https://gaiensai.com/availability
            </a>
            <p>または「<strong>外苑祭 空き状況」</strong>と検索</p>
          </div>
          <QRCode
            value='https://gaiensai.com/availability'
            size={104}
            className={styles.qrCode}
          />
        </aside>
      </header>
      <div className={styles.legend} aria-label='空き状況の判例'>
        <span className={`${styles.circle} ${styles.legendItem}`}>
          ○ 余裕あり
        </span>
        <span className={`${styles.triangle} ${styles.legendItem}`}>
          △ 残り10%以下
        </span>
        <span className={`${styles.cross} ${styles.legendItem}`}>
          × 売り切れ
        </span>
      </div>
      {grades
        .filter((grade) => gradeFilters.includes(grade))
        .map((grade) => (
          <section className={styles.gradeSection} key={grade}>
            <h2>{grade}年</h2>
            <PerformancesTable
              orientation='classes-as-columns'
              remainingMode='total'
              showFilters={false}
              showLegend={false}
              showScrollHint={false}
              availabilitySource='monitor'
              gradeFilters={[grade]}
              dayFilters={dayFilters}
            />
          </section>
        ))}
        <p className={styles.userGuide}>空きがある公演をご観覧される場合は、<span className={styles.userGuideHighlight}>各クラス前のチケットなしの列</span>に直接お並びください。</p>
    </>
  );
};

export default Availability;
