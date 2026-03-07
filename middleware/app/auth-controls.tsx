"use client";

import { signIn, signOut } from "next-auth/react";

export default function AuthControls({
  isSignedIn,
  userLabel,
}: {
  isSignedIn: boolean;
  userLabel: string | null;
}) {
  return (
    <div className="auth-controls">
      {userLabel ? (
        <div className="auth-controls__identity">
          <span className="auth-controls__caption">Signed in</span>
          <span className="auth-controls__label">{userLabel}</span>
        </div>
      ) : null}
      {isSignedIn ? (
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/" })}
          className="button button--secondary button--small"
        >
          Sign out
        </button>
      ) : (
        <button
          type="button"
          onClick={() => signIn("github", { callbackUrl: "/sandboxes" })}
          className="button button--primary button--small"
        >
          Sign in with GitHub
        </button>
      )}
    </div>
  );
}
