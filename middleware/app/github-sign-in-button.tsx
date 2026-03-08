"use client";

import { signIn } from "next-auth/react";

export default function GitHubSignInButton({
  callbackUrl = "/dashboard",
  className,
  children,
}: {
  callbackUrl?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => signIn("github", { callbackUrl })}
      className={className}
    >
      {children}
    </button>
  );
}
