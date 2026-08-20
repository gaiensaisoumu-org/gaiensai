import { useTitle } from '../../hooks/useTitle';
import styles from '../../styles/sub-pages.module.css';
import mapImage from '../../assets/map.webp';
import mapImage1 from '../../assets/map1.webp';
import mapImage2 from '../../assets/map2.webp';
import Modal2 from '../../components/ui/Modal2';
import Alert from '../../components/ui/Alert';

const Map = () => {
  useTitle('校内マップ');
  return (
    <>
      <Modal2 />
      <h1 className={styles.pageTitle}>校内マップ</h1>

      <Alert type='info'>
        <h3>クイズ研究部の方へ</h3>
        <p>
          校内マップの表示が「クイズ研究会」になっていることの修正依頼は、すでに8/3には総務に伝達しましたが、
          依然訂正版が届いておりません。
          ご迷惑をおかけしていますこと、お詫び申し上げます。
        </p>
      </Alert>

      <img
        src={mapImage}
        alt='校内マップ'
        className={`${styles.map} ${styles.desktopMap}`}
      />
      <div className={styles.mobileMapImages}>
        <img src={mapImage1} alt='校内マップ（前半）' className={styles.map} />
        <img src={mapImage2} alt='校内マップ（後半）' className={styles.map} />
      </div>

      {/* 別のタブで開くボタンを追加 */}
      <div className={styles.buttonContainer}>
        <a
          href={mapImage}
          target='_blank'
          rel='noopener noreferrer'
          className={styles.openButton}
        >
          別のタブでマップを開く
        </a>
      </div>
    </>
  );
};

export default Map;
