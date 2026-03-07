"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AuthControls from "./auth-controls";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function SiteNav(props: {
  authConfigured: boolean;
  isSignedIn: boolean;
  userLabel: string | null;
}) {
  const pathname = usePathname();
  const signedInLinks = [
    { href: "/sandboxes", label: "Sandboxes" },
    { href: "/templates", label: "Templates" },
    { href: "/connector", label: "Connector" },
  ];

  if (!props.isSignedIn) {
    return (
      <header className="public-header">
        <div className="public-header__inner">
          <Link href="/" className="brand">
            <span className="brand__mark">SC</span>
            <span className="brand__copy">
              <span className="brand__eyebrow">Sandcastle</span>
              <span className="brand__title">Sandbox control plane</span>
            </span>
          </Link>

          {props.authConfigured ? (
            <AuthControls
              isSignedIn={props.isSignedIn}
              userLabel={props.userLabel}
            />
          ) : (
            <div className="auth-status">GitHub auth not configured</div>
          )}
        </div>
      </header>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar__section">
        <Link href="/sandboxes" className="brand">
          <span className="brand__mark">SC</span>
          <span className="brand__copy">
            <span className="brand__eyebrow">Sandcastle</span>
            <span className="brand__title">Sandbox control plane</span>
          </span>
        </Link>

        <nav className="sidebar__nav" aria-label="Primary">
          {signedInLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="sidebar__link"
              data-active={isActive(pathname, link.href)}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="sidebar__section sidebar__section--muted">
        <div className="sidebar__label">Workflow</div>
        <p className="sidebar__note">
          Start sandboxes from the web or SHGO, use Connector for secure
          handoffs, and keep previews, logs, and task state here.
        </p>
      </div>

      <div className="sidebar__footer">
        <AuthControls
          isSignedIn={props.isSignedIn}
          userLabel={props.userLabel}
        />
      </div>
    </aside>
  );
}
