import { useTitle } from '../../hooks/useTitle';
import styles from '../../styles/sub-pages.module.css';
import posterImg from '../../assets/poster.webp';
import Modal2 from '../../components/ui/Modal2';

const Pamphlet = () => {
  useTitle('パンフレット');
  return (
    <>
      <Modal2 />
      <h1 className={styles.pageTitle}>パンフレット</h1>
      <img
        src={posterImg}
        alt='外苑祭2026 ポスター'
        className={styles.poster}
      />
      <section>
        ただいま、パンフレットを作成中です。しばらくお待ちください。
      </section>
    </>
  );
};

export default Pamphlet;
