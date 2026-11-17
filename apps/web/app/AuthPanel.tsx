"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DataClient } from "@dib/data-client";
import { getBrowserDataClient } from "@/lib/browser-data-client";

type SessionState = { userId: string | null; email: string | null } | null;

/**
 * Auth block for the account page. Uses the anon key only (public by
 * design); never reads or displays any secret, and never logs payload
 * contents. Errors surface as typed {data, error} results from
 * @dib/data-client — never raw SDK throws.
 */
export default function AuthPanel() {
  const [client, setClient] = useState<DataClient | null>(null);
  const [session, setSession] = useState<SessionState>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const c = getBrowserDataClient();
    if (!c) {
      setNotice("Sign-in requires a connected account service.");
      return;
    }
    const res = c.auth.onAuthChange((_event, next) => setSession(next));
    if (res.error) {
      setNotice("Sign-in could not start.");
      return;
    }
    setClient(c);
    return res.data?.unsubscribe;
  }, []);

  async function sendMagicLink() {
    if (!client || !email.trim() || busy) return;
    setBusy(true);
    setNotice(null);
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await client.auth.signInWithEmailOtp(email.trim(), redirectTo);
    setBusy(false);
    setNotice(
      error
        ? `Could not send the link: ${error.message}`
        : "Check your email — the sign-in link is on its way. It signs you in right here when clicked."
    );
    if (!error) setEmail("");
  }

  async function signOut() {
    if (!client || busy) return;
    setBusy(true);
    setNotice(null);
    const { error } = await client.auth.signOut();
    setBusy(false);
    if (error) setNotice(`Could not sign out: ${error.message}`);
  }

  if (session?.email) {
    return (
      <div className="flex flex-col sm:flex-row items-stretch gap-3 rounded-2xl border border-line bg-page/70 p-4 shadow-sm">
        <div className="flex-1 text-sm leading-6">
          <p className="font-medium">Signed in{session.email ? ` as ${session.email}` : ""}.</p>
          <p className="text-ink-2">
            Open the <Link href="/simulator" className="underline">simulator</Link> to save a report.
          </p>
          {notice ? <p role="status">{notice}</p> : null}
        </div>
        <button
          onClick={signOut}
          disabled={busy}
          className="theatre-button"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-page/70 p-4 shadow-sm text-left">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          disabled={!client || busy}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void sendMagicLink();
          }}
          className="theatre-select min-w-0 flex-1"
          aria-label="Email address for sign-in link"
        />
        <button
          onClick={() => void sendMagicLink()}
          disabled={!client || busy || !email.trim()}
          className="theatre-button theatre-primary"
        >
          {busy ? "Sending…" : "Email me a sign-in link"}
        </button>
      </div>
      {notice ? (
        <p className="text-xs text-ink-2" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
