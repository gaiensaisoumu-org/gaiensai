import { useState } from 'preact/hooks';
import styles from './Modal2.module.css';
import { MdClose } from 'react-icons/md';

// 1. 期限付きで保存する関数
function setItemWithExpiry(key: string, value: string, ttlInMilliseconds: number) {
  const now = new Date();

  // 保存するデータと有効期限（現在時刻 + TTL）をオブジェクトにする
  const item = {
    value: value,
    expiry: now.getTime() + ttlInMilliseconds,
  };

  localStorage.setItem(key, JSON.stringify(item));
}

// 2. 期限をチェックして読み込む関数
function getItemWithExpiry(key: string) {
  const itemStr = localStorage.getItem(key);

  // データが存在しない場合は null
  if (!itemStr) {
    return null;
  }

  const item = JSON.parse(itemStr);
  const now = new Date();

  // 現在時刻が有効期限を過ぎていたら削除して null を返す
  if (now.getTime() > item.expiry) {
    localStorage.removeItem(key);
    return null;
  }

  return item.value;
}

const isShowedVisitorGuideLimit = 3 * 24 * 60 * 60* 1000;

const Modal2 = () => {
  const [isOpen, setIsOpen] = useState(true);
  const [isAlreadyOpened, setIsAlreadyOpened] = useState(() => {
    if (typeof window !== 'undefined') {
      const isShowedVisitorGuide = getItemWithExpiry('isShowedVisitorGuide');
      return isShowedVisitorGuide ?? false;
    }
    return 'ゲスト';
  });
  const handleIsOpen = () => {
    setIsOpen(false);
    setIsAlreadyOpened(true);
    setItemWithExpiry('isShowedVisitorGuide', 'true', isShowedVisitorGuideLimit);
  };
  return (
    <>
      {isOpen && !isAlreadyOpened && (
        <div
          className={styles.modal}
          role='dialog'
          aria-labelledby='split-dialog-title'
        >
          <div className={styles.modalContent}>
            <h2 id='split-dialog-title' className={styles.modalTitle}>
              ご案内
            </h2>
            <button
              className={styles.modalClose}
              onClick={handleIsOpen}
              aria-label='閉じる'
            >
              <MdClose />
            </button>
            <p className={styles.modalGuideText}>
              外苑祭には
              <strong className={styles.modalGuide}>
                一般公開はございません。
              </strong>
            </p>
            <p>
              <strong className={styles.linedText}>
                青高生からの招待券をお持ちの方、および事前申込をした中学生のみ
              </strong>
              ご来場いただけます。
            </p>
            <p>一般の方のご来場は、お断りしておりますのでご了承ください。</p>
            <div className={styles.modalActions}>
              <button
                type='button'
                onClick={handleIsOpen}
                className={styles.modalButtonPrimary}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Modal2;
