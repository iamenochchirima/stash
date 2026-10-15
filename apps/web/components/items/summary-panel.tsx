"use client";
import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { Item, SummaryStatus, SummaryResult } from "@stash/shared";
import { api } from "../../lib/api";
const errors: Record<string, string> = {
  source_unavailable:
    "We could not read enough source text. The page may be unavailable, paywalled or unsupported.",
  source_changed:
    "This item changed during generation. Reload it before trying again.",
  free_model_unavailable:
    "The free summary model is unavailable. Try again later.",
  provider_rate_limit: "The AI provider is busy. Try again later.",
  summary_not_grounded:
    "The response did not pass our source checks. It was not saved.",
  provider_invalid_response:
    "The response was incomplete or could not be verified. It was not saved.",
  provider_rejected:
    "The AI provider could not accept this request. Try again later.",
  access_revoked:
    "Generation stopped because access to the item or connection changed.",
  provider_budget_violation:
    "Summaries are paused because the provider reported an unexpected charge.",
  provider_budget_locked:
    "Summaries are paused while the usage limit is reviewed.",
};
export function SummaryPanel({
  item,
  onPdfPage,
}: {
  item: Item;
  onPdfPage: (page: number) => void;
}) {
  const [status, setStatus] = useState<SummaryStatus | null>(null),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [requestId, setRequestId] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const next = await api<SummaryStatus>(`/items/${item.id}/summary`);
        if (stopped) return;
        setStatus(next);
        if (next.job && ["queued", "running"].includes(next.job.state))
          timer = setTimeout(load, 3000);
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
    }
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [item.id, item.revision, refresh]);
  const active =
    !!status?.job && ["queued", "running"].includes(status.job.state);
  async function generate() {
    setBusy(true);
    setError("");
    const identity = requestId || crypto.randomUUID();
    setRequestId(identity);
    try {
      await api(`/items/${item.id}/summary`, {
        method: "POST",
        body: JSON.stringify({ revision: item.revision, requestId: identity }),
      });
      setRequestId(null);
      setRefresh((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function openReferences() {
    const details =
      document.querySelector<HTMLDetailsElement>(".summary-sources");
    if (details) details.open = true;
  }
  function claim(value: SummaryResult["overview"]) {
    const sources = value.sourceIds
      .map((id) => status?.saved?.sources.find((s) => s.id === id))
      .filter(
        (s, i, all) =>
          s && all.findIndex((other) => other?.label === s.label) === i,
      );
    return (
      <>
        <span>{value.text}</span>
        <span className="summary-citations">
          {sources.length > 2 ? (
            <a href="#summary-references" onClick={openReferences}>
              {sources.length} sources
            </a>
          ) : (
            sources.map((source) =>
              source?.page ? (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => onPdfPage(source.page!)}
                >
                  {source.label}
                </button>
              ) : (
                <a
                  key={source?.id}
                  href={`#summary-source-${source?.id}`}
                  onClick={openReferences}
                >
                  {source?.label}
                </a>
              ),
            )
          )}
        </span>
      </>
    );
  }
  return (
    <section className="summary-panel" aria-label="AI summary">
      <div className="summary-heading">
        <h2>Summary</h2>
        {active ? (
          <button
            className="text-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api(`/items/${item.id}/summary/cancel`, {
                  method: "POST",
                  body: "{}",
                });
                setRefresh((v) => v + 1);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Cancel
          </button>
        ) : (
          status?.available && (
            <button
              className="button secondary"
              disabled={
                busy || (item.kind === "pdf" && item.pdf?.state !== "ready")
              }
              onClick={() => void generate()}
            >
              {busy ? "Requesting…" : status.saved ? "Regenerate" : "Summarise"}
            </button>
          )
        )}
      </div>
      {status?.saved && (
        <div className="summary-content">
          <p>{claim(status.saved.result.overview)}</p>
          <ul>
            {status.saved.result.points.map((point, i) => (
              <li key={i}>{claim(point)}</li>
            ))}
          </ul>
          {status.saved.partial && (
            <p className="summary-note">
              Covers part of the source. Read the original for the full
              document.
            </p>
          )}
          {status.saved.stale && (
            <p className="summary-note">
              The source text changed since this summary was made.
            </p>
          )}
          <details className="summary-sources" id="summary-references">
            <summary>Source references</summary>
            {status.saved.sources.map((source) => (
              <div id={`summary-source-${source.id}`} key={source.id}>
                <h3>{source.label}</h3>
                <blockquote>{source.excerpt}</blockquote>
              </div>
            ))}
          </details>
          <p className="summary-note">
            {status.saved.imported
              ? "Imported snapshot, summarised"
              : "Source snapshot summarised"}{" "}
            {new Date(status.saved.createdAt).toLocaleDateString()} ·{" "}
            {status.saved.model}
          </p>
        </div>
      )}
      {active && (
        <p className="summary-progress" role="status">
          <LoaderCircle className="spin" size={14} />
          {status?.job?.state === "queued"
            ? "Waiting to summarise…"
            : "Reading the source…"}{" "}
          You can return later.
        </p>
      )}
      {status?.job?.state === "unknown" && (
        <p className="summary-note">
          The provider's outcome could not be confirmed. This request will not
          retry automatically.
          {status.saved ? " Your previous summary is still saved." : ""}
        </p>
      )}
      {status?.job?.state === "failed" && (
        <p className="summary-note">
          {errors[status.job.errorCode || ""] ||
            "The summary could not be completed. Try again later."}
          {status.saved ? " Your previous summary is still saved." : ""}
        </p>
      )}
      {!status?.saved && !active && status && !status.available && (
        <p className="summary-note">Summaries are not configured yet.</p>
      )}
      {!active && status?.available && (
        <p className="summary-note">
          Sends source text to OpenRouter. Your notes are not sent.{" "}
          {Math.max(
            0,
            status.limits.dailyRequests - status.usage.requestsToday,
          )}{" "}
          of {status.limits.dailyRequests} requests left today, resetting at
          midnight UTC.
        </p>
      )}
      {status?.available && (
        <details className="summary-privacy">
          <summary>Privacy</summary>
          <p className="summary-note">
            Source text goes to OpenRouter and its model provider. Routing
            excludes providers flagged for data collection. Provider retention
            policies and OpenRouter account logging settings still apply. Stash
            stores the summary and source snapshot with your item.{" "}
            <a
              href="https://openrouter.ai/docs/guides/privacy/provider-logging"
              target="_blank"
              rel="noopener noreferrer"
            >
              Provider policies
            </a>
          </p>
        </details>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
