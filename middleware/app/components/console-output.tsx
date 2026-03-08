"use client";

import { useEffect, useRef } from "react";

export default function ConsoleOutput({
  content,
  autoScroll = true,
}: {
  content: string;
  autoScroll?: boolean;
}) {
  const ref = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (!autoScroll) return;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [autoScroll, content]);

  return (
    <pre ref={ref} className="console-output">
      {content || "Waiting for console output from the sandbox..."}
    </pre>
  );
}
