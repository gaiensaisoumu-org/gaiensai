import GlobalNav from './GlobalNav';

import { MdClose } from 'react-icons/md';
import styles from './Drawer.module.css';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

const Drawer = ({ isOpen, onClose }: Props) => {
  return (
    <>
      <div
        className={`${styles.drawerOverlay} ${isOpen && styles.open}`}
        onClick={onClose}
        aria-hidden={!isOpen}
      />
      <aside
        className={`${styles.drawerPanel} ${isOpen ? styles.open : ''}`}
        inert={!isOpen}
      >
        <button
          className={styles.drawerClose}
          onClick={onClose}
          aria-label='閉じる'
        >
          <MdClose />
        </button>
        <div className={styles.drawerContent}>
          <GlobalNav />
        </div>
      </aside>
    </>
  );
};

export default Drawer;
