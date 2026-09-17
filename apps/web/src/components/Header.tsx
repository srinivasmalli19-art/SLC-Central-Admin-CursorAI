interface HeaderProps {
  onToggleSidebar: () => void;
}

export function Header({ onToggleSidebar }: HeaderProps) {
  return (
    <header className="header">
      <button
        type="button"
        className="header__menu-btn"
        aria-label="Toggle navigation"
        onClick={onToggleSidebar}
      >
        <span aria-hidden="true">☰</span>
      </button>
      <div className="header__title">SLC Central Admin</div>
      <div className="header__spacer" />
      <div className="header__env" title="Administration control center">
        Control Center
      </div>
    </header>
  );
}
