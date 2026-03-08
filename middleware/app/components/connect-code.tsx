"use client";

import { useEffect, useState } from "react";

export default function ConnectCode({
  code,
  expiresAt,
}: {
  code: string;
  expiresAt: number;
}) {
  const [copied, setCopied] = useState(false);
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const next = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setRemaining(next);
      if (next <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const countdown = `${minutes}:${String(seconds).padStart(2, "0")}`;

  return (
    <div className="connect-hero">
      <div className="connect-code">{code}</div>
      <div className="connect-countdown">
        {remaining > 0 ? `Expires in ${countdown}` : "Code expired — refresh to generate a new one"}
      </div>
      <button
        type="button"
        className="button button--secondary button--small"
        onClick={handleCopy}
      >
        {copied ? "Copied" : "Copy code"}
      </button>
    </div>
  );
}
