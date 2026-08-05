import { useState } from 'preact/hooks';
import styles from './Modal.module.css';

type ModalProps = {
  setIsOpen: (isOpen: boolean) => void;
  handleAction: () => void | Promise<void>;
  headingText: string;
  buttonText: string;
  children?: preact.ComponentChildren;
  showCancelButton?: boolean;
  closeOnOverlayClick?: boolean;
  cancelButtonText?: string;
  onCancel?: () => void;
};

const Modal = ({
  setIsOpen,
  handleAction,
  headingText,
  buttonText,
  children,
  showCancelButton = true,
  closeOnOverlayClick = true,
  cancelButtonText = 'キャンセル',
  onCancel,
}: ModalProps) => {
  const [isDoingAction, setIsDoingAction] = useState(false);
  const handleOnClick = async () => {
    setIsDoingAction(true);
    try {
      await handleAction();
    } finally {
      setIsDoingAction(false);
    }
  };

  return (
    <div
      className={styles.modalOverlay}
      role='presentation'
      onMouseDown={(event) => {
        if (closeOnOverlayClick && event.target === event.currentTarget) {
          setIsOpen(false);
        }
      }}
    >
      <div
        className={styles.modal}
        role='dialog'
        aria-modal='true'
        aria-labelledby='delete-account-title'
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id='delete-account-title' className={styles.modalTitle}>
          {headingText}
        </h2>
        {children}
        <div className={styles.modalActions}>
          {showCancelButton ? (
            <button
              type='button'
              className={styles.modalCancelButton}
              onClick={() => {
                if (onCancel) {
                  onCancel();
                  return;
                }
                setIsOpen(false);
              }}
              disabled={isDoingAction}
            >
              {cancelButtonText}
            </button>
          ) : null}
          <button
            type='button'
            className={styles.modalActionButton}
            onClick={handleOnClick}
            disabled={isDoingAction}
          >
            {isDoingAction ? 'お待ちください...' : buttonText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Modal;
