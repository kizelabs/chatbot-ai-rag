import { dbHttp, incidents } from "@chatbot/db";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function IncidentsPage() {
  const rows = await dbHttp.select().from(incidents).orderBy(desc(incidents.createdAt)).limit(100);

  return (
    <section className="rounded-2xl border border-ink/20 bg-black/55 p-6 shadow-panel backdrop-blur">
      <header className="mb-6">
        <p className="font-mono text-base uppercase tracking-[0.2em] text-ink/60">Failures</p>
        <h2 className="text-2xl font-bold">Incidents</h2>
      </header>

      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="rounded-xl border border-ink/15 bg-black/70 p-4 transition hover:-translate-y-0.5 hover:shadow-sm">
            <p className="font-mono text-base uppercase tracking-[0.16em] text-ink/65">
              {row.kind} · {row.createdAt.toISOString()}
            </p>
            <pre className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-ink/90">{JSON.stringify(row.detail, null, 2)}</pre>
          </li>
        ))}
      </ul>
    </section>
  );
}
