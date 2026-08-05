type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
};

const Switch = ({ checked, onChange, id }: SwitchProps) => {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      aria-label='切り替え'
      onClick={() => onChange(!checked)}
      style={{
        position: 'relative',
        width: '34px',
        height: '20px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        padding: 0,
        border: 0,
        background: 'transparent',
      }}
    >
      {id && <span id={id} />}
      <div
        style={{
          width: '34px',
          height: '14px',
          backgroundColor: checked
            ? 'rgba(63, 81, 181, 0.5)'
            : 'rgba(0, 0, 0, 0.26)',
          borderRadius: '7px',
          transition: 'background-color 0.2s',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: checked ? '14px' : '0px',
          width: '20px',
          height: '20px',
          backgroundColor: checked ? '#3f51b5' : '#fafafa',
          borderRadius: '50%',
          boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
          transition: 'left 0.2s, background-color 0.2s',
        }}
      />
    </button>
  );
};

export default Switch;
