import { dbHttp, conversations, messages } from "@chatbot/db";
import { desc, eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function ConversationsPage() {
  const rows = await dbHttp
    .select({
      jid: conversations.jid,
      displayName: conversations.displayName,
      updatedAt: conversations.updatedAt,
      messageCount: sql<number>`count(${messages.id})`
    })
    .from(conversations)
    .leftJoin(messages, eq(messages.jid, conversations.jid))
    .groupBy(conversations.jid, conversations.displayName, conversations.updatedAt)
    .orderBy(desc(conversations.updatedAt));

  return (
    <section className="rounded-2xl border border-ink/20 bg-black/55 p-6 shadow-panel backdrop-blur">
      <header className="mb-6">
        <p className="font-mono text-base uppercase tracking-[0.2em] text-ink/60">Threads</p>
        <h2 className="text-2xl font-bold">Conversations</h2>
      </header>

      <ul className="divide-y divide-ink/10">
        {rows.map((row) => (
          <li key={row.jid}>
            <a
              href={`/conversations/${encodeURIComponent(row.jid)}`}
              className="neon-link flex items-center justify-between gap-4 rounded-lg px-3 py-3 transition hover:bg-black/70"
            >
              <div>
                <p className="font-semibold text-ink">{row.displayName ?? "Unknown Contact"}</p>
                <p className="font-mono text-base text-ink/60">{row.jid}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-base uppercase tracking-wider text-ink/55">Messages</p>
                <p className="text-lg font-bold text-ink">{row.messageCount ?? 0}</p>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
