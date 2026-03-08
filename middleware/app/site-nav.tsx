"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AuthControls from "./auth-controls";
import BrandLogo from "./brand-logo";

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
  userImage: string | null;
}) {
  const pathname = usePathname();
  const signedInLinks = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/marketplace", label: "Marketplace" },
    { href: "/environment", label: "Environment" },
    { href: "/connect", label: "Connectors" },
    { href: "/profile", label: "Profile" },
  ];

  if (!props.isSignedIn) {
    return (
      <header className="public-header">
        <div className="public-header__inner">
          <BrandLogo href="/" priority />

          {props.authConfigured ? (
            <AuthControls
              isSignedIn={props.isSignedIn}
              userLabel={props.userLabel}
              userImage={props.userImage}
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
        <div className="sidebar__brand">
          <BrandLogo href="/dashboard" />
        </div>

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

      <div className="sidebar__footer">
        <AuthControls
          isSignedIn={props.isSignedIn}
          userLabel={props.userLabel}
          userImage={props.userImage}
        />
      </div>
    </aside>
  );
}
