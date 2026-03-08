import type { ReactNode } from "react";

export default function Panel({
  kicker,
  title,
  description,
  variant,
  actions,
  children,
  className,
}: {
  kicker?: string;
  title?: string;
  description?: string;
  variant?: "muted" | "console";
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const classes = [
    "panel",
    variant === "muted" && "panel--muted",
    variant === "console" && "panel--console",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const hasHeader = kicker || title || actions;

  return (
    <section className={classes}>
      {hasHeader && (
        <div className={actions ? "panel__header panel__header--split" : "panel__header"}>
          <div>
            {kicker && <p className="page-kicker">{kicker}</p>}
            {title && <h2 className="panel__title">{title}</h2>}
          </div>
          {actions}
        </div>
      )}
      {description && <p className="panel__description">{description}</p>}
      {children}
    </section>
  );
}
