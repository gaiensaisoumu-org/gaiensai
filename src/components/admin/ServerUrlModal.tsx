import { useEffect, useRef, useState } from 'preact/hooks';
import styles from './ServerUrlModal.module.css';

type Props = {
  isOpen: boolean;
  currentUrl: string | undefined;
  onSave: (url: string) => void;
  onContinueWithoutServer: () => void;
};

export const ServerUrlModal = ({
  isOpen,
  currentUrl,
  onSave,
  onContinueWithoutServer,
}: Props) => {
  const [tempUrl, setTempUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTempUrl(currentUrl || '');
      // モーダルが開いた時にフォーカスを当てる
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, currentUrl]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalContainer}>
        <div className={styles.modalContent}>
          <h2 className={styles.modalTitle}>読み取り履歴同期サーバーの設定</h2>
          <p>
            親となるコンピューターで付属のserver.exeを実行してローカルサーバーを立てた上で、そのURLを入力してください。
          </p>
          <div>
            <label
              className={styles.formLabel}
              htmlFor='server-url-modal-input'
            >
              サーバーURL
            </label>
            <input
              ref={inputRef}
              id='server-url-modal-input'
              className={styles.textInput}
              type='text'
              value={tempUrl}
              onChange={(e) => setTempUrl(e.currentTarget.value)}
              placeholder='http://127.0.0.1:8000'
            />
          </div>
          <div className={styles.modalButtonGroup}>
            <button
              type='button'
              className={styles.cancelButton}
              onClick={onContinueWithoutServer}
            >
              同期しない
            </button>
            <button
              type='button'
              className={styles.submitButton}
              onClick={() => onSave(tempUrl)}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
