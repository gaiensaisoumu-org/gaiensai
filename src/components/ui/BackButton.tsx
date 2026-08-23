import { useLocation } from 'preact-iso';
import { MdArrowBack } from 'react-icons/md';
import styles from './BackButton.module.css';

type BackButtonProps = {
  href?: string;
  fallbackHref?: string;
  onClick?: () => void;
};

const BackButton = ({ href, fallbackHref = '/', onClick }: BackButtonProps) => {
  const { route } = useLocation();

  const handleBack = () => {
    if (onClick) {
      onClick();
      return;
    }

    if (href) {
      route(href);
      return;
    }

    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    route(fallbackHref);
  };

  return (
    <div className={styles.topActions}>
      <button
        type='button'
        className={styles.topBackButton}
        onClick={handleBack}
      >
        <MdArrowBack />
        戻る
      </button>
    </div>
  );
};

export default BackButton;
