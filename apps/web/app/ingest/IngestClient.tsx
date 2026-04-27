"use client";

import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import useSWR from "swr";
import { ingestDocument, retryIngestJob } from "../actions";
import type { IngestJob } from "@chatbot/config";

const ACCEPTED_EXTENSIONS =
  ".txt,.md,.markdown,.csv,.json,.yaml,.yml,.log,.ini,.toml,.pdf,.doc,.docx,.rtf,.xls,.xlsx,.ods,.ppt,.pptx,.odp,image/*";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Failed to fetch ingest queue");
  }
  return res.json();
};

const formatSize = (size: number | null): string => {
  if (size == null) {
    return "-";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const formatTotalSize = (files: File[]): string => {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  return formatSize(total);
};

const toRelativeTime = (value: string | null | undefined): string => {
  if (!value) {
    return "Waiting";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const deltaMs = Date.now() - date.getTime();
  if (deltaMs < 10_000) {
    return "just now";
  }

  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.floor(hours / 24)}d ago`;
};

const isRefreshStale = (value: string | null | undefined): boolean => {
  if (!value) {
    return true;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return true;
  }

  return Date.now() - date.getTime() > 10_000;
};

const liveSyncClass = (stale: boolean): string =>
  stale ? "border-amber-400/35 bg-amber-400/10 text-ink/80" : "border-pine/35 bg-pine/10 text-ink/80";

const hasActiveIngest = (jobs: IngestJob[]): boolean =>
  jobs.some(
    (job) =>
      job.status === "queued" ||
      job.status === "processing" ||
      job.stage === "extracting" ||
      job.stage === "embedding" ||
      job.stage === "indexing"
  );

const getSyncModeLabel = (jobs: IngestJob[]): string => (hasActiveIngest(jobs) ? "active" : "idle");

const getSyncDotClass = (jobs: IngestJob[]): string =>
  hasActiveIngest(jobs)
    ? "bg-pine shadow-[0_0_12px_rgba(34,197,94,0.65)] animate-pulse"
    : "bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.55)]";

const statusClass = (status: IngestJob["status"]) => {
  switch (status) {
    case "ready":
      return "border-pine/40 bg-pine/15 text-ink";
    case "queued":
      return "border-amber-400/40 bg-amber-400/10 text-ink";
    case "processing":
      return "border-sky-400/40 bg-sky-400/10 text-ink";
    case "stored":
      return "border-sky-400/40 bg-sky-400/10 text-ink";
    case "error":
      return "border-rose-400/40 bg-rose-400/10 text-ink";
    default:
      return "border-ink/20 bg-black/60 text-ink";
  }
};

const stageLabel: Record<NonNullable<IngestJob["stage"]>, string> = {
  queued: "Queued",
  extracting: "Extracting text",
  chunking: "Chunking",
  embedding: "Embedding",
  indexing: "Indexing",
  stored: "Stored",
  error: "Error"
};

const kindLabel: Record<IngestJob["kind"], string> = {
  text: "Text",
  doc: "Word",
  sheet: "Sheet",
  ppt: "PPT",
  pdf: "PDF",
  image: "Image"
};

const getJobProgress = (job: IngestJob): string => {
  if (job.status === "stored") {
    return `Stored • ${job.chunkCount ?? 1} row${(job.chunkCount ?? 1) === 1 ? "" : "s"}`;
  }

  if (job.status === "error") {
    return job.lastError ? `Error • ${job.lastError}` : "Error";
  }

  const stage = job.stage ? stageLabel[job.stage] : null;
  if (stage) {
    return stage;
  }

  if (job.status === "processing") {
    return "Processing";
  }

  if (job.status === "queued" || job.status === "ready") {
    return "Queued";
  }

  return "-";
};

const toShortDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
};

export default function IngestClient({ jobs }: { jobs: IngestJob[] }) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [copiedErrorJobId, setCopiedErrorJobId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const { data } = useSWR<{ jobs: IngestJob[]; refreshedAt?: string }>("/api/ingest", fetcher, {
    refreshInterval: (latestData) => (hasActiveIngest(latestData?.jobs ?? jobs) ? 1000 : 5000),
    fallbackData: { jobs, refreshedAt: undefined }
  });

  const currentJobs = data?.jobs ?? jobs;
  const refreshStale = isRefreshStale(data?.refreshedAt);
  const syncMode = getSyncModeLabel(currentJobs);
  const recentJobs = useMemo(() => currentJobs.slice(0, 8), [currentJobs]);

  const applyFiles = (files: File[], submit = false) => {
    setSelectedFiles(files);
    const input = fileInputRef.current;
    if (!input) {
      return;
    }

    const dataTransfer = new DataTransfer();
    for (const file of files) {
      dataTransfer.items.add(file);
    }

    input.files = dataTransfer.files;

    if (submit && files.length > 0) {
      formRef.current?.requestSubmit();
    }
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    applyFiles(Array.from(event.target.files ?? []), true);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingFiles(false);
    applyFiles(Array.from(event.dataTransfer.files ?? []), true);
  };

  const copyJobError = async (job: IngestJob) => {
    const message = job.lastError?.trim();
    if (!message) {
      return;
    }

    await navigator.clipboard.writeText(message);
    setCopiedErrorJobId(job.id);
    window.setTimeout(() => {
      setCopiedErrorJobId((current) => (current === job.id ? null : current));
    }, 1500);
  };

  return (
    <section className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
      <div className="space-y-6">
        <header className="border-b border-ink/15 pb-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-base uppercase tracking-[0.24em] text-ink/60">Document Intake</p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight">Upload files into the vector store</h2>
              <p className="mt-2 max-w-2xl text-base text-ink/75">
                Upload one or more files. There is no title field and no file type selector. Each file becomes one row in
                the Zilliz collection.
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 font-mono text-xs uppercase tracking-[0.2em] ${liveSyncClass(refreshStale)}`}>
              <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle ${getSyncDotClass(currentJobs)}`} />
              Live sync • {syncMode} • {toRelativeTime(data?.refreshedAt)}
            </span>
          </div>
        </header>

        <form ref={formRef} action={ingestDocument} encType="multipart/form-data" className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm text-ink/75">Files</span>
            <div
              className={`rounded-2xl border border-dashed p-4 transition ${
                isDraggingFiles ? "border-pine/70 bg-pine/10" : "border-ink/25 bg-black/60"
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={() => setIsDraggingFiles(true)}
              onDragLeave={() => setIsDraggingFiles(false)}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDraggingFiles(true);
              }}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
            >
              <div className="rounded-xl border border-ink/20 bg-black/70 px-4 py-4">
                <input
                  ref={fileInputRef}
                  name="file"
                  type="file"
                  multiple
                  accept={ACCEPTED_EXTENSIONS}
                  className="hidden"
                  onChange={handleFileInputChange}
                />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm uppercase tracking-[0.18em] text-ink/60">Drop files here</p>
                    <p className="mt-2 text-base text-ink/75">
                      Drag and drop markdown, text, PDF, Word, spreadsheet, presentation, or image files.
                    </p>
                    <p className="mt-2 font-mono text-xs uppercase tracking-[0.18em] text-ink/55">
                      {selectedFiles.length
                        ? `${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""} ready`
                        : "No files selected"}
                    </p>
                    <p className="mt-1 font-mono text-xs uppercase tracking-[0.18em] text-ink/55">
                      {selectedFiles.length ? `Total ${formatTotalSize(selectedFiles)}` : "Total -"}
                    </p>
                  </div>
                  <span className="rounded-full border border-ink/20 bg-black/80 px-3 py-2 font-mono text-xs uppercase tracking-[0.18em] text-ink/70">
                    Browse files
                  </span>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_220px]">
                  <div>
                    <p className="font-mono text-sm uppercase tracking-[0.18em] text-ink/60">File-only ingestion</p>
                    <p className="mt-2 text-base text-ink/75">
                      The worker extracts text from each file, embeds it with NVIDIA LangChain embeddings, and stores a
                      single vector row per file.
                    </p>
                    <p className="mt-2 text-sm text-ink/60">
                      File metadata and extracted text are saved with the vector record for retrieval.
                    </p>
                  </div>

                  <div className="rounded-xl border border-ink/15 bg-black/70 p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-ink/55">Selected files</p>
                    <p className="mt-2 font-mono text-sm text-ink">{selectedFiles.length ? `${selectedFiles.length} file(s)` : "None"}</p>
                    <div className="mt-2 space-y-1">
                      {selectedFiles.slice(0, 4).map((file) => (
                        <div key={`${file.name}-${file.size}`} className="flex items-center justify-between gap-3 text-xs text-ink/70">
                          <span className="min-w-0 truncate font-mono">{file.name}</span>
                          <span className="font-mono">{formatSize(file.size)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={selectedFiles.length === 0}
              className="neon-btn rounded-xl border border-accent/45 bg-accent/20 px-5 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-ink transition hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Process files
            </button>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink/55">
              Each selected file becomes its own ingest job.
            </p>
          </div>
        </form>

        <section className="rounded-2xl border border-ink/15 bg-black/55 p-5 shadow-panel">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-sm uppercase tracking-[0.2em] text-ink/55">Queue</p>
              <h3 className="text-xl font-bold">Recent ingest jobs</h3>
            </div>
            <span className="rounded-full border border-ink/20 bg-black/70 px-3 py-1 font-mono text-xs uppercase tracking-[0.18em] text-ink/65">
              {currentJobs.length} total
            </span>
          </div>

          <div className="space-y-3">
            {recentJobs.length ? (
              recentJobs.map((job) => (
                <article key={job.id} className="rounded-xl border border-ink/15 bg-black/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink/55">
                        {kindLabel[job.kind]} • {job.status}
                      </p>
                      <h4 className="truncate text-lg font-semibold">{job.fileName ?? job.title}</h4>
                      <p className="mt-1 font-mono text-xs uppercase tracking-[0.14em] text-ink/50">
                        {toShortDate(job.createdAt)}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusClass(job.status)}`}>
                      {job.status}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-2 text-sm text-ink/80 sm:grid-cols-2">
                    <div>
                      <span className="text-ink/55">Progress</span>
                      <div className="font-mono text-xs uppercase tracking-[0.14em] text-ink/70">{getJobProgress(job)}</div>
                    </div>
                    <div>
                      <span className="text-ink/55">Size</span>
                      <div className="font-mono text-xs uppercase tracking-[0.14em] text-ink/70">{formatSize(job.size)}</div>
                    </div>
                    <div>
                      <span className="text-ink/55">Source</span>
                      <div className="font-mono text-xs uppercase tracking-[0.14em] text-ink/70">{job.sourceType}</div>
                    </div>
                    <div>
                      <span className="text-ink/55">Updated</span>
                      <div className="font-mono text-xs uppercase tracking-[0.14em] text-ink/70">{toShortDate(job.updatedAt)}</div>
                    </div>
                  </div>

                  {job.status === "error" ? (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <form action={retryIngestJob}>
                        <input type="hidden" name="id" value={job.id} />
                        <button
                          type="submit"
                          className="neon-btn rounded-lg border border-accent/45 bg-accent/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink transition hover:bg-accent/30"
                        >
                          Retry
                        </button>
                      </form>
                      <button
                        type="button"
                        onClick={() => void copyJobError(job)}
                        className="neon-btn rounded-lg border border-ink/25 bg-black/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink transition hover:bg-black/85"
                      >
                        {copiedErrorJobId === job.id ? "Copied" : "Copy error"}
                      </button>
                      <p className="font-mono text-xs uppercase tracking-[0.14em] text-ink/55">
                        Re-queues the same uploaded file.
                      </p>
                    </div>
                  ) : null}
                </article>
              ))
            ) : (
              <p className="rounded-xl border border-ink/15 bg-black/60 p-4 text-ink/70">No ingest jobs yet.</p>
            )}
          </div>
        </section>
      </div>

      <aside className="space-y-4 rounded-2xl border border-ink/15 bg-black/55 p-5 shadow-panel">
        <div>
          <p className="font-mono text-sm uppercase tracking-[0.2em] text-ink/55">Rules</p>
          <h3 className="mt-2 text-xl font-bold">File ingestion behavior</h3>
        </div>

        <div className="space-y-3 text-sm text-ink/75">
          <p>Upload files only. No title field and no file type selector.</p>
          <p>Each file is extracted, embedded with NVIDIA LangChain embeddings, and inserted as one vector row.</p>
          <p>The ingest queue updates live while jobs move through extraction, embedding, indexing, and storage.</p>
        </div>
      </aside>
    </section>
  );
}
