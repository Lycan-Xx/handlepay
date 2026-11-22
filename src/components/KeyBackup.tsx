/**
 * Back up the key kept in this browser: Reveal (hidden until asked), Copy,
 * Download, Download encrypted (NIP-49), and an optional "check my backup".
 *
 * Everything happens in this browser. The files are made from a Blob, so
 * they download with no request and work offline; the key is never sent
 * anywhere. Downloading is not the same as backing up, so nothing here ticks
 * the "I have backed up" box: the person does that themselves.
 */
import { useState } from "react";
import { backupFileName, backupFileText, downloadText, extractKey } from "../lib/backup";
import {
  BACKUP_PASSWORD_MIN,
  backupMatchesBrowserKey,
  browserKeyNpub,
  exportBrowserKey,
  exportBrowserKeyEncrypted,
  isEncryptedKey,
} from "../lib/signer";
import { CopyButton } from "./CopyButton";
import { Icon } from "./Icon";

export function KeyBackup({ name }: { name: string }) {
  const [shown, setShown] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [encrypting, setEncrypting] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState("");
  const [checkPassword, setCheckPassword] = useState("");
  const [checkResult, setCheckResult] = useState<{ ok: boolean; message: string } | null>(null);

  const npub = browserKeyNpub() ?? "";

  const download = () => {
    setError(null);
    const key = exportBrowserKey();
    if (!key) return setError("This browser has no saved key to back up.");
    const file = backupFileName(name, false);
    downloadText(file, backupFileText({ name, npub, key, encrypted: false, created: new Date() }));
    setSaved(`Saved ${file}. Anyone who opens it can act as your name, so keep it somewhere private.`);
  };

  const downloadEncrypted = () => {
    setError(null);
    if (password.length < BACKUP_PASSWORD_MIN) return setError(`Use a password of at least ${BACKUP_PASSWORD_MIN} characters.`);
    if (password !== password2) return setError("The two passwords don't match.");
    setEncrypting(true);
    // Encrypting takes about a second (that's the protection); let the button say so first.
    setTimeout(() => {
      try {
        const key = exportBrowserKeyEncrypted(password);
        if (!key) throw new Error("This browser has no saved key to back up.");
        const file = backupFileName(name, true);
        downloadText(file, backupFileText({ name, npub, key, encrypted: true, created: new Date() }));
        setSaved(`Saved ${file}. You need the password to restore it; HandlePay can't recover a forgotten password.`);
        setPassword("");
        setPassword2("");
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setEncrypting(false);
      }
    }, 30);
  };

  const verify = () => {
    const key = extractKey(check) ?? check.trim();
    try {
      const ok = backupMatchesBrowserKey(key, checkPassword || undefined);
      setCheckResult(
        ok
          ? { ok, message: "That's the key saved in this browser. Your backup works." }
          : { ok, message: "That's a different key. It won't restore this name; back up again." },
      );
    } catch (e) {
      setCheckResult({ ok: false, message: (e as Error).message });
    }
  };

  return (
    <div className="keybackup">
      <p className="label">Your identity key</p>
      {shown ? (
        <div className="copyrow">
          <code className="addr">{shown}</code>
          <CopyButton text={shown} />
        </div>
      ) : (
        <div className="copyrow">
          <code className="addr hidden-key" aria-label="Hidden">
            nsec1 •••• •••• •••• •••• •••• ••••
          </code>
          <button type="button" className="ghost" onClick={() => setShown(exportBrowserKey())}>
            <Icon name="visibility" /> Reveal
          </button>
        </div>
      )}

      <div className="strip-actions">
        <button type="button" className="ghost" onClick={download}>
          <Icon name="download" /> Download
        </button>
      </div>

      <div className="subpanel">
        <p className="label">Download encrypted backup (recommended)</p>
        <p className="muted small">
          The file is locked with a password (NIP-49), so it's safer to keep in cloud storage or email. You'll need the
          password to restore.
        </p>
        <label>
          Password (at least {BACKUP_PASSWORD_MIN} characters)
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </label>
        <label>
          Same password again
          <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
        </label>
        <button type="button" className="ghost" onClick={downloadEncrypted} disabled={encrypting || !password}>
          <Icon name="lock" /> {encrypting ? "Encrypting…" : "Download encrypted backup"}
        </button>
      </div>

      {saved && <p className="note green small">{saved}</p>}
      {error && <p className="err">{error}</p>}

      <details className="how">
        <summary>Check my backup (optional)</summary>
        <p className="muted small">Paste the key or the file's contents back in. It's checked here and never sent.</p>
        <label>
          Backup
          <textarea rows={3} value={check} onChange={(e) => setCheck(e.target.value)} spellCheck={false} autoCapitalize="none" />
        </label>
        {isEncryptedKey(extractKey(check) ?? check) && (
          <label>
            Its password
            <input type="password" value={checkPassword} onChange={(e) => setCheckPassword(e.target.value)} />
          </label>
        )}
        <button type="button" className="ghost" onClick={verify} disabled={!check.trim()}>
          Check
        </button>
        {checkResult && <p className={checkResult.ok ? "note green small" : "warn"}>{checkResult.message}</p>}
      </details>
    </div>
  );
}
