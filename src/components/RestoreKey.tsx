/**
 * "I have a backed-up key": restore from a backup file (picked or pasted) or
 * a bare key, as nsec, 64 hex characters or a NIP-49 ncryptsec with its
 * password. The file is read here with File.text(); nothing is uploaded.
 */
import { useState } from "react";
import { extractKey } from "../lib/backup";
import { hasBrowserKey, importBrowserKey, isEncryptedKey } from "../lib/signer";
import { Icon } from "./Icon";

export function RestoreKey({ onRestored, disabled = false }: { onRestored: (pubkey: string) => void; disabled?: boolean }) {
  const [text, setText] = useState("");
  const [password, setPassword] = useState("");
  const [replaceOk, setReplaceOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const key = extractKey(text) ?? text.trim();
  const encrypted = isEncryptedKey(key);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const content = await file.text();
      if (!extractKey(content)) return setError("No key found in that file. Pick the HandlePay backup file.");
      setText(content);
    } catch {
      setError("Couldn't read that file.");
    }
  };

  const restore = () => {
    setError(null);
    setBusy(true);
    // Decrypting an ncryptsec takes about a second; let the button say so first.
    setTimeout(() => {
      try {
        const pub = importBrowserKey(key, { replace: replaceOk, password: password || undefined });
        setText("");
        setPassword("");
        setReplaceOk(false);
        onRestored(pub);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  return (
    <div className="restore">
      <label>
        Backup file
        <input type="file" accept=".txt,text/plain" onChange={pick} disabled={disabled} />
      </label>
      <label>
        Or paste your key (nsec1…, ncryptsec1… or 64 hex characters)
        <textarea
          rows={3}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
        />
      </label>
      {encrypted && (
        <label>
          Backup password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
      )}
      {hasBrowserKey() && (
        <label className="checkrow">
          <input type="checkbox" checked={replaceOk} onChange={(e) => setReplaceOk(e.target.checked)} />
          <span>Replace the key already saved in this browser. I've backed it up.</span>
        </label>
      )}
      <button type="button" className="ghost" onClick={restore} disabled={disabled || busy || !text.trim() || (encrypted && !password)}>
        <Icon name="upload_file" /> {busy ? "Restoring…" : "Restore and use this key"}
      </button>
      {error && <p className="err">{error}</p>}
    </div>
  );
}
