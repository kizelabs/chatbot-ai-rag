"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { addSession, requestPair, requestUnpair } from "../actions";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Failed to fetch status");
  }
  return res.json();
};

const badgeClass = (connected: boolean) =>
  connected
    ? "border border-pine/45 bg-pine/15 text-ink"
    : "border border-rose-400/40 bg-rose-400/10 text-ink";

export default function StatusClient() {
  const [pairingSessionId, setPairingSessionId] = useState<string | null>(null);
  const [pairingQrSeen, setPairingQrSeen] = useState(false);
  const { data, error } = useSWR("/api/status", fetcher, { refreshInterval: 2000 });

  const sessions = (data?.sessions ?? []) as Array<{
    sessionId: string;
    connected: boolean;
    qr: string | null;
    lastHeartbeat: string | null;
    lastError: string | null;
    jid: string | null;
    displayName: string | null;
    phoneNumber: string | null;
    connectedAt: string | null;
    disconnectedAt: string | null;
    disconnectedReason: string | null;
    disconnectedCode: number | null;
  }>;
  const activePairingSession = pairingSessionId
    ? sessions.find((session) => session.sessionId === pairingSessionId) ?? null
    : null;

  useEffect(() => {
    if (!pairingSessionId) {
      setPairingQrSeen(false);
    }
  }, [pairingSessionId]);

  useEffect(() => {
    if (activePairingSession?.qr) {
      setPairingQrSeen(true);
    }
  }, [activePairingSession?.qr]);

  useEffect(() => {
    if (pairingSessionId && pairingQrSeen && activePairingSession?.connected) {
      setPairingSessionId(null);
    }
  }, [activePairingSession?.connected, pairingQrSeen, pairingSessionId]);

  if (error) {
    return <p className="rounded-xl border border-rose-400/40 bg-rose-400/10 px-4 py-3 text-base text-ink">Could not load status.</p>;
  }

  if (!data) {
    return <p className="font-mono text-base text-ink/70">Loading status...</p>;
  }

  return (
    <>
      <section className="rounded-2xl border border-ink/20 bg-black/55 p-6 shadow-panel backdrop-blur">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-base uppercase tracking-[0.2em] text-ink/60">Worker Health</p>
            <h2 className="text-2xl font-bold">Multi Session Status</h2>
          </div>
          <span className={`rounded-full px-3 py-1 text-base font-semibold uppercase tracking-wide ${badgeClass(Boolean(data.connected))}`}>
            {data.connectedCount} Connected
          </span>
        </header>

        <form
          action={addSession}
          onSubmit={(event) => {
            const formData = new FormData(event.currentTarget);
            const sessionId = String(formData.get("sessionId") ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
            if (sessionId) {
              setPairingSessionId(sessionId);
            }
          }}
          className="mb-6 flex flex-wrap items-end gap-2 rounded-xl border border-ink/15 bg-black/60 p-3"
        >
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-sm text-ink/75">New Session ID</span>
            <input
              name="sessionId"
              required
              placeholder="team-alpha"
              className="w-full rounded-lg border border-ink/25 bg-black/70 px-3 py-2 font-mono text-sm text-ink outline-none transition focus:border-ink/45 focus:ring-2 focus:ring-ink/20"
            />
          </label>
          <button
            type="submit"
            className="neon-btn rounded-lg border border-accent/45 bg-accent/20 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-accent/30"
          >
            Add Session
          </button>
        </form>

        <div className="space-y-4">
          {sessions.map((session) => (
            <article key={session.sessionId} className="rounded-xl border border-ink/15 bg-black/60 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-mono text-sm uppercase tracking-[0.16em] text-ink/60">Session</p>
                  <h3 className="text-xl font-bold">{session.sessionId}</h3>
                </div>
                <span className={`rounded-full px-3 py-1 text-sm font-semibold uppercase tracking-wide ${badgeClass(session.connected)}`}>
                  {session.connected ? "Connected" : "Disconnected"}
                </span>
              </div>

              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-ink/70">Phone Number</dt>
                  <dd className="font-mono text-base text-ink/90">{session.phoneNumber ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-sm text-ink/70">JID</dt>
                  <dd className="font-mono text-base text-ink/90">{session.jid ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-sm text-ink/70">Display Name</dt>
                  <dd className="font-mono text-base text-ink/90">{session.displayName ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-sm text-ink/70">Last Heartbeat</dt>
                  <dd className="font-mono text-base text-ink/90">{session.lastHeartbeat ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-sm text-ink/70">Connected At</dt>
                  <dd className="font-mono text-base text-ink/90">{session.connectedAt ?? "-"}</dd>
                </div>
                {!session.connected ? (
                  <>
                    <div>
                      <dt className="text-sm text-ink/70">Disconnected Reason</dt>
                      <dd className="font-mono text-base text-ink/90">{session.disconnectedReason ?? "-"}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-ink/70">Disconnected Code</dt>
                      <dd className="font-mono text-base text-ink/90">{String(session.disconnectedCode ?? "-")}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-ink/70">Disconnected At</dt>
                      <dd className="font-mono text-base text-ink/90">{session.disconnectedAt ?? "-"}</dd>
                    </div>
                  </>
                ) : null}
                <div>
                  <dt className="text-sm text-ink/70">Last Error</dt>
                  <dd className="font-mono text-base text-ink/90">{session.lastError ?? "-"}</dd>
                </div>
              </dl>

              <div className="mt-4 flex gap-2">
                <form action={requestPair}>
                  <input type="hidden" name="sessionId" value={session.sessionId} />
                  <button
                    type="submit"
                    onClick={() => setPairingSessionId(session.sessionId)}
                    className="neon-btn rounded-lg border border-accent/45 bg-accent/20 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-accent/30"
                  >
                    Trigger Pair
                  </button>
                </form>
                <form action={requestUnpair}>
                  <input type="hidden" name="sessionId" value={session.sessionId} />
                  <button
                    type="submit"
                    className="neon-btn rounded-lg border border-ink/25 bg-black/70 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-black/85"
                  >
                    Unpair Session
                  </button>
                </form>
              </div>
            </article>
          ))}
        </div>
      </section>

      {pairingSessionId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setPairingSessionId(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pairing-dialog-title"
            className="w-full max-w-xl rounded-2xl border border-ink/20 bg-black/[0.92] p-5 shadow-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-base uppercase tracking-[0.2em] text-ink/60">Pairing Dialog</p>
                <h3 id="pairing-dialog-title" className="text-2xl font-bold">
                  {pairingSessionId}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPairingSessionId(null)}
                className="neon-btn rounded-lg border border-ink/25 bg-black/70 px-3 py-2 text-sm font-semibold text-ink transition hover:bg-black/85"
              >
                Close
              </button>
            </div>

            <div className="mt-5 rounded-xl border border-ink/15 bg-black/70 p-4">
              {activePairingSession?.connected ? (
                <div className="rounded-xl border border-pine/35 bg-pine/10 p-4">
                  <p className="font-mono text-base uppercase tracking-widest text-ink">Session connected.</p>
                  <p className="mt-1 text-base text-ink/80">The QR dialog will close automatically.</p>
                </div>
              ) : activePairingSession?.qr ? (
                <img
                  src={`/api/qr?sessionId=${encodeURIComponent(activePairingSession.sessionId)}&v=${encodeURIComponent(
                    String(activePairingSession.lastHeartbeat ?? "0")
                  )}`}
                  alt={`WhatsApp pairing QR code for ${activePairingSession.sessionId}`}
                  className="mx-auto h-72 w-72 rounded-lg border border-ink/20 bg-white object-contain p-2"
                />
              ) : (
                <div className="min-h-72 rounded-xl border border-ink/15 bg-black/60 p-4">
                  <p className="sliding-highlight font-mono text-base uppercase tracking-widest">Waiting for QR payload...</p>
                  <p className="mt-3 text-base text-ink/75">
                    The session is being created. Once the QR arrives it will render here, and the dialog will close after the
                    device connects.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
