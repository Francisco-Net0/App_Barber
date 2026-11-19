import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

export default function ProfileMenu({ options }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const pointerType = useRef('');

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div
      className={`profile-menu${open ? ' open' : ''}`}
      ref={menuRef}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="profile-menu-trigger"
        aria-label="Abrir menu do perfil"
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={(event) => { pointerType.current = event.pointerType; }}
        onClick={() => {
          if (pointerType.current === 'mouse') setOpen(true);
          else setOpen((isOpen) => !isOpen);
          pointerType.current = '';
        }}
      >
        <Icon name="user" size={20} />
      </button>
      <div className="profile-dropdown" role="menu">
        {options.map((option) => (
          option.href ? (
            <a key={option.label} href={option.href} role="menuitem" onClick={() => setOpen(false)}>
              <Icon name={option.icon} size={17} />
              {option.label}
            </a>
          ) : (
            <button key={option.label} type="button" role="menuitem" onClick={() => {
              setOpen(false);
              option.onSelect();
            }}>
              <Icon name={option.icon} size={17} />
              {option.label}
            </button>
          )
        ))}
      </div>
    </div>
  );
}
