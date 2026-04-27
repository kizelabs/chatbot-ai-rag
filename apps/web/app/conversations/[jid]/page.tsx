import { dbHttp, messages } from "@chatbot/db";
import { asc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const roleClass = (role: string) => {
  if (role === "assistant") {
    return "border-pine/35 bg-pine/15";
  }
  if (role === "tool") {
    return "border-accent/35 bg-accent/15";
  }
  return "border-ink/15 bg-black/70";
};

export default async function ConversationPage({ params }: { params: Promise<{ jid: string }> }) {
  const { jid } = await params;
  const decoded = decodeURIComponent(jid);

  const rows = await dbHttp.select().from(messages).where(eq(messages.jid, decoded)).orderBy(asc(messages.createdAt));

  return (
    <section className="rounded-2xl border border-ink/20 bg-black/55 p-6 shadow-panel backdrop-blur">
      <header className="mb-6">
        <p className="font-mono text-base uppercase tracking-[0.2em] text-ink/60">Transcript</p>
        <h2 className="break-all text-2xl font-bold">{decoded}</h2>
      </header>

      <div className="space-y-3">
        {rows.map((row) => (
          <article key={row.id} className={`rounded-xl border p-4 transition hover:-translate-y-0.5 hover:shadow-sm ${roleClass(row.role)}`}>
            <p className="font-mono text-base uppercase tracking-[0.15em] text-ink/60">
              {row.role} · {row.createdAt.toISOString()} {row.modelUsed ? `· ${row.modelUsed}` : ""}
            </p>
            <pre className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-ink">{row.content}</pre>
            {row.toolCalls ? (
              <details className="mt-3 rounded-lg border border-ink/20 bg-black/70 p-3">
                <summary className="cursor-pointer font-mono text-base uppercase tracking-wider text-ink/70">tool calls</summary>
                <pre className="mt-2 whitespace-pre-wrap font-mono text-base text-ink/85">{JSON.stringify(row.toolCalls, null, 2)}</pre>
              </details>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
