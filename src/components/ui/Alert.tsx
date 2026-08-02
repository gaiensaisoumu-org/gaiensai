import styles from './Alert.module.css';
import { IoWarning, IoInformationCircle, IoAlertCircle } from 'react-icons/io5';

type AlertProps = {
  children: preact.ComponentChildren;
  className?: string;
  type?: 'warning' | 'error' | 'info';
  style?: typeof styles;
};

const Alert = ({
  children,
  className,
  type = 'warning',
  style: alertStyles,
  ...props
}: AlertProps) => {
  const classes = className
    ? `${styles.alert} ${styles[type]} ${className}`
    : `${styles.alert} ${styles[type]}`;

  let Icon = IoWarning;
  let title = '注意';

  if (type === 'info') {
    Icon = IoInformationCircle;
    title = 'お知らせ';
  } else if (type === 'error') {
    Icon = IoAlertCircle;
    title = 'エラー';
  }

  return (
    <div className={classes} {...props} style={alertStyles}>
      <h2>
        <Icon />
        {title}
      </h2>
      {children}
    </div>
  );
};

export default Alert;
