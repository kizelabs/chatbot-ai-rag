import {
  addAllowlist,
  deleteAllowlist,
  saveModelsJson,
  updateAllowlist
} from "../actions";
import { readAllowlistConfig, readModelsJson } from "../file-config";

export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-lg border border-ink/25 bg-black/70 px-3 py-2 font-mono text-sm text-ink outline-none transition focus:border-ink/45 focus:ring-2 focus:ring-ink/20";

const sectionTitle = "font-mono text-base uppercase tracking-[0.2em] text-ink/60";
const toDisplayNumber = (jid: string): string => jid.split("@")[0]?.replace(/\D/g, "") ?? "";

export default async function ConfigPage() {
  const modelsJson = await readModelsJson();
  const allowlist = await readAllowlistConfig();

  return (
    <section className="rounded-2xl border border-ink/20 bg-black/55 p-6 shadow-panel backdrop-blur">
      <header className="mb-6">
        <p className={sectionTitle}>Runtime Controls</p>
        <h2 className="text-2xl font-bold">JSON File Config</h2>
        <p className="mt-2 text-base text-ink/75">Manage `models.json` and `allowlist.json` with simple CRUD forms.</p>
      </header>

      <div className="space-y-8">
        <section className="rounded-xl border border-ink/15 bg-black/60 p-4">
          <h3 className="text-xl font-semibold">Models</h3>
          <p className="mt-1 text-sm text-ink/70">
            Edit the full NVIDIA-style JSON directly. The worker will still read the file and normalize it for runtime.
          </p>

          <form action={saveModelsJson} className="mt-4 space-y-3 rounded-lg border border-ink/15 bg-black/65 p-3">
            <label className="block">
              <span className="mb-1 block text-sm text-ink/75">models.json</span>
              <textarea
                className="min-h-[28rem] w-full rounded-lg border border-ink/25 bg-black/70 px-3 py-2 font-mono text-sm text-ink outline-none transition focus:border-ink/45 focus:ring-2 focus:ring-ink/20"
                name="json"
                defaultValue={modelsJson}
                spellCheck={false}
              />
            </label>
            <button
              type="submit"
              className="neon-btn rounded-lg border border-accent/45 bg-accent/20 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-accent/30"
            >
              Save Models JSON
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-ink/15 bg-black/60 p-4">
          <h3 className="text-xl font-semibold">Allowlist</h3>
          <p className="mt-1 text-sm text-ink/70">
            Show and edit numbers only. System saves as `number@s.whatsapp.net`.
          </p>

          <div className="mt-4 space-y-2">
            {allowlist.map((jid, index) => (
              <div key={`${jid}-${index}`} className="rounded-lg border border-ink/15 bg-black/65 p-3">
                <form className="flex flex-nowrap items-end gap-2">
                  <input type="hidden" name="index" value={index} />
                  <label className="min-w-0 flex-1">
                    <span className="mb-1 block text-sm text-ink/75">Number</span>
                    <input
                      className={inputClass}
                      name="jid"
                      defaultValue={toDisplayNumber(jid)}
                      inputMode="numeric"
                      pattern="[0-9]+"
                      required
                    />
                  </label>
                  <button
                    type="submit"
                    formAction={updateAllowlist}
                    className="neon-btn rounded-lg border border-ink/30 bg-black/70 px-3 py-2 text-sm font-semibold text-ink transition hover:bg-black/85"
                  >
                    Save
                  </button>
                  <button
                    type="submit"
                    formAction={deleteAllowlist}
                    className="neon-btn rounded-lg border border-rose-400/35 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-ink transition hover:bg-rose-500/20"
                  >
                    Delete
                  </button>
                </form>
              </div>
            ))}
          </div>

          <form action={addAllowlist} className="mt-4 grid gap-2 rounded-lg border border-ink/15 bg-black/65 p-3 md:grid-cols-[1fr_auto] md:items-end">
            <label>
              <span className="mb-1 block text-sm text-ink/75">New Number</span>
              <input
                className={inputClass}
                name="jid"
                placeholder="6281234567890"
                inputMode="numeric"
                pattern="[0-9]+"
                required
              />
            </label>
            <button
              type="submit"
              className="neon-btn rounded-lg border border-accent/45 bg-accent/20 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-accent/30"
            >
              Add JID
            </button>
          </form>
        </section>
      </div>
    </section>
  );
}
