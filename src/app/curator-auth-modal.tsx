"use client";

import { useId, useRef, useState } from "react";
import type { CuratorAuthState } from "@/lib/auth/curator";
import { ModalDialog, useDialogClose } from "./modal-dialog";

function CuratorAuthForm({
  titleId,
  promptReason,
  onClose,
  onAuthenticated,
  isSubmitting,
  setIsSubmitting,
}: {
  titleId: string;
  promptReason?: string | null;
  onClose: () => void;
  onAuthenticated: (nextState: CuratorAuthState) => void;
  isSubmitting: boolean;
  setIsSubmitting: (submitting: boolean) => void;
}) {
  const closeDialog = useDialogClose() ?? onClose;
  const idPrefix = useId();
  const passphraseId = `${idPrefix}-passphrase`;
  const hintId = `${idPrefix}-hint`;
  const errorId = `${idPrefix}-error`;

  const passphraseRef = useRef<HTMLInputElement>(null);

  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMsg("");

    if (!passphrase.trim()) {
      setErrorMsg("Please enter the curator passphrase.");
      passphraseRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        authRequired?: boolean;
        isCurator?: boolean;
        error?: string;
      };

      if (!response.ok) {
        setErrorMsg(
          data.error ||
            (response.status === 429
              ? "Too many sign-in attempts. Please wait a moment and try again."
              : "Invalid curator passphrase."),
        );
        setIsSubmitting(false);
        window.requestAnimationFrame(() => {
          passphraseRef.current?.focus();
        });
        return;
      }

      setIsSubmitting(false);
      onAuthenticated({ authRequired: true, isCurator: true });
      onClose();
    } catch {
      setErrorMsg("Network error while verifying curator passphrase.");
      setIsSubmitting(false);
      window.requestAnimationFrame(() => {
        passphraseRef.current?.focus();
      });
    }
  };

  return (
    <div className="catalogue-auth-card">
      <button
        type="button"
        className="card-close-slip"
        onClick={closeDialog}
        disabled={isSubmitting}
        aria-label="Close curator sign-in"
      >
        <span className="slip-cancel">Close</span>
        <span className="slip-stamp font-mono">DISMISS</span>
      </button>

      <header className="pathfinder-card-header">
        <span className="card-rubric-tag font-mono">curator access</span>
        <h2 id={titleId}>Curator Sign In</h2>
        <p className="pathfinder-subtitle">
          {promptReason ||
            "Enter the curator passphrase to add volumes, update the reading ledger, or manage editorial connections."}
        </p>
      </header>

      <form
        method="post"
        className="auth-form"
        onSubmit={handleSubmit}
        aria-labelledby={titleId}
        noValidate
      >
        <div className="editor-field">
          <label htmlFor={passphraseId}>
            Curator passphrase <span aria-hidden="true">*</span>
          </label>
          <span id={hintId} className="auth-field-hint">
            Required for shelf accessions, reading notes, and curated links.
          </span>

          <div className="passphrase-input-row">
            <input
              ref={passphraseRef}
              id={passphraseId}
              name="passphrase"
              type={showPassphrase ? "text" : "password"}
              autoComplete="current-password"
              enterKeyHint="done"
              required
              autoFocus
              value={passphrase}
              onChange={(event) => {
                setPassphrase(event.target.value);
                if (errorMsg) {
                  setErrorMsg("");
                }
              }}
              aria-invalid={errorMsg ? true : undefined}
              aria-describedby={errorMsg ? `${errorId} ${hintId}` : hintId}
            />
            <button
              type="button"
              className="passphrase-toggle-btn font-mono"
              aria-pressed={showPassphrase}
              aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}
              onClick={() => setShowPassphrase((prev) => !prev)}
            >
              {showPassphrase ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        {errorMsg && (
          <p id={errorId} className="editor-error auth-error" role="alert">
            <span aria-hidden="true">⚠</span> <span>{errorMsg}</span>
          </p>
        )}

        <div className="editor-actions">
          <button
            type="button"
            className="pathfinder-btn btn-secondary font-mono"
            onClick={closeDialog}
            disabled={isSubmitting}
          >
            CANCEL
          </button>
          <button
            type="submit"
            className="pathfinder-btn btn-primary font-mono"
            disabled={isSubmitting}
          >
            {isSubmitting ? "VERIFYING..." : "SIGN IN"}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Native modal dialog prompting for the curator passphrase to unlock catalogue mutations.
 */
export function CuratorAuthModal({
  open = true,
  promptReason,
  onClose,
  onAuthenticated,
}: {
  open?: boolean;
  promptReason?: string | null;
  onClose: () => void;
  onAuthenticated: (nextState: CuratorAuthState) => void;
}) {
  const titleId = useId();
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      closedBy={isSubmitting ? "none" : "any"}
      preventClose={isSubmitting}
      className="catalogue-dialog--auth"
    >
      <CuratorAuthForm
        titleId={titleId}
        promptReason={promptReason}
        onClose={onClose}
        onAuthenticated={onAuthenticated}
        isSubmitting={isSubmitting}
        setIsSubmitting={setIsSubmitting}
      />
    </ModalDialog>
  );
}
