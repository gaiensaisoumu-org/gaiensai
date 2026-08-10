import styles from './NormalSection.module.css';

type NormalSectionProps = {
  children: preact.ComponentChildren;
  className?: string;
  onClick?: () => void;
};

const NormalSection = ({
  children,
  className,
  ...props
}: NormalSectionProps) => {
  const classes = className
    ? `${styles.normalSection} ${className}`
    : styles.normalSection;

  return (
    <section className={classes} {...props}>
      {children}
    </section>
  );
};

export default NormalSection;
