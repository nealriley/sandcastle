"use client";

import { useState } from "react";
import { readError } from "@/lib/fetch-utils";

export default function PromptComposer({
  sessionKey,
  sandboxId,
  disabled = false,
  onSuccess,
}: {
  sessionKey: string;
  sandboxId: string;
  disabled?: boolean;
  onSuccess?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "neutral" | "danger";
    text: string;
  } | null>(null);

  async function handleSubmit() {
    const prompt = draft.trim();
    if (!prompt) {
      setFeedback({ tone: "danger", text: "Enter a prompt before sending." });
      return;
    }

    setBusy(true);
    setFeedback(null);

    try {
      const response = await fetch(
        `/api/sandboxes/${encodeURIComponent(sessionKey)}/prompt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        }
      );
      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setDraft("");
      setFeedback({
        tone: "neutral",
        text: `Started a new task in sandbox ${sandboxId}.`,
      });
      onSuccess?.();
    } catch (error) {
      setFeedback({
        tone: "danger",
        text: error instanceof Error ? error.message : "Failed to send prompt.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="prompt-composer">
      {feedback && (
        <div
          className={
            feedback.tone === "danger" ? "alert alert--error" : "alert alert--neutral"
          }
        >
          {feedback.text}
        </div>
      )}

      <label className="form-field">
        <span className="form-label">Follow-up prompt</span>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Send a follow-up prompt to ${sandboxId}`}
          rows={3}
          disabled={disabled || busy}
        />
      </label>

      <div className="page-header__actions">
        <button
          type="button"
          className="button button--primary button--small"
          onClick={() => void handleSubmit()}
          disabled={disabled || busy}
        >
          {busy ? "Sending..." : "Send prompt"}
        </button>
      </div>
    </div>
  );
}
