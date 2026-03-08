"use client";

import { signOut } from "next-auth/react";
import GitHubSignInButton from "./github-sign-in-button";

export default function AuthControls({
  isSignedIn,
  userLabel,
  userImage,
}: {
  isSignedIn: boolean;
  userLabel: string | null;
  userImage: string | null;
}) {
  return (
    <div className="auth-controls">
      {isSignedIn ? (
        <div
          className="auth-controls__avatar"
          title={userLabel ?? "Signed in with GitHub"}
          aria-label={userLabel ?? "Signed in with GitHub"}
        >
          {userImage ? (
            <img
              src={userImage}
              alt={userLabel ? `${userLabel} GitHub avatar` : "GitHub avatar"}
              className="auth-controls__avatar-image"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="auth-controls__avatar-fallback">GH</span>
          )}
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
        <GitHubSignInButton
          callbackUrl="/dashboard"
          className="button button--primary button--small"
        >
          Sign in with GitHub
        </GitHubSignInButton>
      )}
    </div>
  );
}
