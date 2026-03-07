"use client";

import { useState } from "react";

export default function CopyCodeButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      className="button button--secondary button--small copy-button"
      onClick={handleClick}
    >
      {copied ? "Copied" : "Copy phrase"}
    </button>
  );
}
