import type { ReactNode } from "react";

export default function PageShell({
  kicker,
  title,
  subtitle,
  actions,
  badges,
  children,
}: {
  kicker?: string;
  title: string;
  subtitle?: string | ReactNode;
  actions?: ReactNode;
  badges?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="page-stack">
      <section className="page-header">
        <div className="page-header__copy">
          {badges && <div className="page-header__badges">{badges}</div>}
          {kicker && <p className="page-kicker">{kicker}</p>}
          <h1 className="page-title">{title}</h1>
          {subtitle && (
            typeof subtitle === "string"
              ? <p className="page-subtitle">{subtitle}</p>
              : subtitle
          )}
        </div>
        {actions && <div className="page-header__actions">{actions}</div>}
      </section>
      {children}
    </div>
  );
}
