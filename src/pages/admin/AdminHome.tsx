import styles from '../../styles/sub-pages.module.css';
import { useTitle } from '../../hooks/useTitle';

const AdminHome = () => {
  useTitle('管理画面');
  return (
    <div>
      <h1 className={styles.pageTitle}>管理画面</h1>
      <section>
        <h2>管理画面へようこそ</h2>
        <p>
          セキュリティ上の理由から、各ページへのURLは貼っていません。Teamsのマニュアルからそれぞれのページへアクセスしてください。
        </p>
      </section>
    </div>
  );
};

export default AdminHome;
