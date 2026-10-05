import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import type { Metadata, QueryTrace, SearchResponse } from "../server/api.ts";

const sources: Record<string, string> = { cs: "Computer Science", stackoverflow: "Stack Overflow" };
const examples = ["binary search time complexity", "P versus NP", "hash table collisions", "C++ branch prediction"];
const number = (value: number) => value.toLocaleString();
const decimal = (value: number) => value.toFixed(4);
const safeLink = (value: string | null | undefined) => value && /^https?:\/\//i.test(value) ? value : undefined;

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "The request failed. Try again.");
  return body as T;
}

function App() {
  const initial = new URLSearchParams(location.search).get("q") ?? "";
  const [query, setQuery] = useState(initial);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [inspect, setInspect] = useState(false);
  const [trace, setTrace] = useState<QueryTrace | null>(null);
  const [traceError, setTraceError] = useState("");
  const [selected, setSelected] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);
  const inspectOpener = useRef<HTMLButtonElement | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  async function search(text: string, updateHistory = true) {
    const value = text.trim();
    activeRequest.current?.abort();
    setQuery(text);
    setInspect(false);
    setTrace(null);
    setTraceError("");
    setError("");
    setResult(null);
    if (updateHistory) history.pushState(null, "", value ? `/?q=${encodeURIComponent(value)}` : "/");
    if (!value) { setLoading(false); document.title = "Trace · Search, from first principles"; return; }
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    try {
      const response = await get<SearchResponse>(`/search?q=${encodeURIComponent(value)}`, controller.signal);
      setResult(response);
      setSelected(response.hits[0]?.doc_id ?? "");
      document.title = `${value} · Trace`;
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Search failed. Try again.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    get<Metadata>("/metadata", controller.signal).then(setMetadata).catch(() => {});
    if (initial) void search(initial, false);
    const back = () => { void search(new URLSearchParams(location.search).get("q") ?? "", false); };
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !target.matches("input, textarea, select, [contenteditable]")) {
        event.preventDefault(); input.current?.focus();
      }
    };
    window.addEventListener("popstate", back);
    window.addEventListener("keydown", shortcut);
    return () => { controller.abort(); activeRequest.current?.abort(); window.removeEventListener("popstate", back); window.removeEventListener("keydown", shortcut); };
  }, []);

  useEffect(() => {
    if (!inspect || !result) return;
    const controller = new AbortController();
    setTraceError("");
    get<QueryTrace>(`/trace/${result.query_id}`, controller.signal).then(setTrace).catch((failure) => {
      if (!controller.signal.aborted) setTraceError(failure instanceof Error ? failure.message : "Could not load this trace.");
    });
    panel.current?.focus({ preventScroll: true });
    if (matchMedia("(max-width: 1000px)").matches) panel.current?.scrollIntoView({ block: "start" });
    return () => controller.abort();
  }, [inspect, result]);

  function closeInspect() { setInspect(false); inspectOpener.current?.focus(); }
  const submit = (event: FormEvent) => { event.preventDefault(); void search(query); };
  const ledger = trace?.results.find((hit) => hit.doc_id === selected);
  const active = result?.hits.find((hit) => hit.doc_id === selected);
  const hasSearch = loading || Boolean(result) || Boolean(error);

  return <div className="app">
    <a className="skip" href="#results">Skip to results</a>
    <header className="header">
      <a className="wordmark" href="/" onClick={(event) => { event.preventDefault(); void search(""); document.title = "Trace · Search, from first principles"; }}>Trace<span className="wordmark-dot" aria-hidden="true">.</span></a>
      <span className="header-note">Search, from first principles.</span>
      {metadata && <span className="corpus">{number(metadata.documents)} posts <span aria-hidden="true">·</span> {metadata.sources.length} sources</span>}
    </header>
    <main>
      <section className={`search-area ${hasSearch ? "searched" : ""}`} aria-label="Search technical sources">
        {!hasSearch && <><h1>Find the source.<br /><span>Follow the reasoning.</span></h1><p className="intro">Search technical knowledge. See exactly how each result earns its place.</p></>}
        <form className="search-form" onSubmit={submit} role="search">
          <label className="sr-only" htmlFor="query">Search technical sources</label>
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <input ref={input} id="query" name="q" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={512} placeholder="Ask a technical question" autoComplete="off" type="search" />
          <button className="primary" type="submit" disabled={!query.trim() || loading}>{loading ? "Searching…" : "Search"}</button>
        </form>
        {!hasSearch && <div className="examples"><span>Try a query</span>{examples.map((text) => <button key={text} onClick={() => { void search(text); }}>{text}</button>)}</div>}
      </section>
      <div className={`workspace ${inspect ? "with-inspect" : ""}`}>
        <section id="results" className="results" aria-label="Search results" aria-busy={loading}>
          <div className="sr-only" role="status">{loading ? "Searching" : result ? `${result.hits.length} results shown, ${number(result.docs_scored)} posts scored` : ""}</div>
          {loading && <div className="loading"><p>Searching the index…</p>{[1, 2, 3].map((key) => <div className="skeleton" key={key} aria-hidden="true"><span /><span /><span /></div>)}</div>}
          {error && <div className="message" role="alert"><h2>Search couldn’t finish</h2><p>{error}</p><button className="text-button" onClick={() => { void search(query); }}>Try again</button></div>}
          {result && <>
            <div className="results-bar"><p>{number(result.docs_scored)} posts scored <span className="timing">· {result.timings.total_ms.toFixed(1)} ms server time</span></p><button className="inspect-button" aria-expanded={inspect} aria-controls="inspect" onClick={(event) => { if (inspect) closeInspect(); else { inspectOpener.current = event.currentTarget; setInspect(true); } }}>Inspect ranking</button></div>
            {!result.hits.length ? <div className="message"><h2>No matching posts</h2><p>Try a different term or a more specific technical phrase. Common words alone may be removed by the analyzer.</p></div> : <ol className="result-list">{result.hits.map((hit, rank) => <li key={hit.doc_id} className={inspect && selected === hit.doc_id ? "selected" : ""}>
              <div className="source-line"><span>{sources[hit.source] ?? hit.source}</span><span>{hit.content_type === "answer" ? "Answer" : "Question"}</span><span className="rank">#{rank + 1}</span></div>
              <h2><a href={safeLink(hit.uri)}>{hit.title || `Answer on ${sources[hit.source] ?? hit.source}`}</a></h2>
              <p className="snippet">{hit.snippet}</p>
              <div className="result-footer"><span>{hit.attribution && <><a href={safeLink(hit.attribution.author_uri)}>{hit.attribution.author}</a><span className="separator">·</span>{hit.attribution.license}</>}{hit.published_at && <><span className="separator">·</span>{new Date(hit.published_at).toLocaleDateString("en", { year: "numeric", month: "short" })}</>}</span><button className="text-button" onClick={(event) => { inspectOpener.current = event.currentTarget; setSelected(hit.doc_id); setInspect(true); }}>Inspect result<span className="sr-only"> {rank + 1}</span></button></div>
            </li>)}</ol>}
            {result.hits.length > 0 && <p className="results-end">{result.pipeline.includes("rerank") ? `Showing the top ${result.hits.length} after cross-encoder reranking of the ${result.pipeline.includes("rrf") ? "fused BM25 and dense" : "BM25"} candidates.` : result.pipeline.includes("rrf") ? `Showing the top ${result.hits.length} by reciprocal rank fusion of BM25 and dense retrieval.` : `Showing the top ${result.hits.length} by BM25. Every matching document is scored.`}</p>}
          </>}
        </section>
        {inspect && <aside id="inspect" ref={panel} className="inspect" tabIndex={-1} aria-labelledby="inspect-title" onKeyDown={(event) => { if (event.key === "Escape") closeInspect(); }}>
          <div className="inspect-heading"><div><h2 id="inspect-title">Inside this search</h2><p>Evidence from the engine</p></div><button className="close" onClick={closeInspect} aria-label="Close Inspect"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></div>
          {traceError ? <div role="alert"><p>{traceError === "Trace not found" ? "This trace has expired. Run the search again to inspect it." : traceError}</p><button className="text-button" onClick={() => { void search(result!.query); }}>Run search again</button></div> : !trace ? <p role="status">Loading engine evidence…</p> : <>
            <div className="trace-section"><h3>Query pipeline</h3><ol className="stages">{trace.stages.map((stage) => <li key={stage.name}><span>{stage.name}</span><span>{number(stage.count)} {stage.unit}</span><strong>{stage.ms.toFixed(2)} ms</strong></li>)}</ol><p className="detail">{number(trace.postings_visited)} postings scored. {trace.mode === "bmw" ? "Block-Max WAND" : trace.mode === "maxscore" ? "MaxScore" : "Exhaustive"} document-at-a-time retrieval.</p></div>
            {trace.postings.length > 0 && <div className="trace-section"><h3>Postings</h3><div className="table-scroll" tabIndex={0} role="region" aria-label="Postings per query term"><table><caption className="sr-only">Postings statistics per query term</caption><thead><tr><th scope="col">Term</th><th scope="col">df</th><th scope="col">Blocks</th><th scope="col">Bytes</th><th scope="col">Decoded</th><th scope="col">Skipped</th></tr></thead><tbody>{trace.postings.map((term) => <tr key={term.term}><th scope="row">{term.term}</th><td>{number(term.df)}</td><td>{number(term.blocks)}</td><td>{number(term.bytes)}</td><td>{number(term.blocks_decoded)}</td><td>{number(term.blocks_skipped)}</td></tr>)}</tbody></table></div><p className="detail">Blocks hold 128 compressed postings. Skipped blocks were passed over by their skip data and never decoded.</p></div>}
            {trace.fusion && <div className="trace-section"><h3>Retrievers</h3><ol className="stages"><li><span>BM25</span><span>top {number(trace.fusion.bm25)}</span><strong>{number(trace.fusion.bm25 - trace.fusion.overlap)} only</strong></li><li><span>Dense, {trace.fusion.dense_mode === "ann" ? "HNSW" : "exact"}</span><span>top {number(trace.fusion.dense)}</span><strong>{number(trace.fusion.dense - trace.fusion.overlap)} only</strong></li><li><span>Both</span><span>overlap</span><strong>{number(trace.fusion.overlap)}</strong></li></ol><p className="detail">Reciprocal rank fusion with k={trace.fusion.k} merged {number(trace.fusion.fused)} distinct candidates. Each list adds 1/(k + rank) for every document it returned.</p></div>}
            <div className="trace-section"><h3>Analyzed query</h3><div className="tokens">{trace.tokens.length ? trace.tokens.map((token, i) => <code key={i}>{token}</code>) : <span>No searchable tokens</span>}</div><p className="detail">{trace.analyzer} analyzer · BM25 k1={trace.parameters.k1}, b={trace.parameters.b}</p></div>
            {ledger && active && <div className="trace-section ledger"><label htmlFor="selected-result">Result ledger</label><select id="selected-result" value={selected} onChange={(event) => setSelected(event.target.value)}>{result!.hits.map((hit, rank) => <option key={hit.doc_id} value={hit.doc_id}>#{rank + 1} · {hit.title || "Untitled answer"}</option>)}</select><div className="score-line"><span>BM25 score <strong>{ledger.bm25 ? decimal(ledger.bm25.score) : "not in top 100"}</strong></span><span>{number(ledger.document_length)} tokens</span></div>
              {trace.fusion && <><p className="rank-path" aria-label="Rank movement">{[ledger.bm25 ? `BM25 #${ledger.bm25.rank}` : "not in BM25 top 100", ledger.dense ? `dense #${ledger.dense.rank}` : "not in dense top 100", ledger.rrf && `hybrid #${ledger.rrf.rank}`, ledger.rerank && `reranked #${ledger.rerank.rank}`].filter(Boolean).join(" → ")}</p>
              <dl className="signals"><div><dt>Retrieved by</dt><dd>{ledger.bm25 && ledger.dense ? "BM25 and dense" : ledger.bm25 ? "BM25 only" : "dense only"}</dd></div><div><dt>Dense similarity</dt><dd>{ledger.dense ? decimal(ledger.dense.similarity) : "none"}</dd></div><div><dt>RRF score</dt><dd>{ledger.rrf ? decimal(ledger.rrf.score) : "none"}</dd></div><div><dt>Reranker logit</dt><dd>{ledger.rerank ? decimal(ledger.rerank.score) : "none"}</dd></div></dl></>}
              {!trace.fusion && ledger.rerank && <dl className="signals"><div><dt>Rank movement</dt><dd>BM25 #{ledger.bm25?.rank} → reranked #{ledger.rerank.rank}</dd></div><div><dt>Reranker logit</dt><dd>{decimal(ledger.rerank.score)}</dd></div></dl>}<div className="table-scroll" tabIndex={0} role="region" aria-label="BM25 term evidence"><table><caption className="sr-only">BM25 components for the selected result</caption><thead><tr><th scope="col">Term</th><th scope="col">tf</th><th scope="col">df</th><th scope="col">idf</th><th scope="col">Norm</th><th scope="col">Score</th></tr></thead><tbody>{ledger.terms.map((term) => <tr key={term.term}><th scope="row">{term.term}{term.query_tf > 1 && <small> ×{term.query_tf}</small>}</th><td>{number(term.tf)}</td><td>{number(term.df)}</td><td>{decimal(term.idf)}</td><td>{decimal(term.length_norm)}</td><td>{decimal(term.contribution)}</td></tr>)}</tbody></table></div><p className="detail">tf: occurrences in this post. df: posts containing the term. idf: rarity weight. Norm: length normalization. Score: this term’s contribution.</p><p className="detail">The engine supplies every value above. Display values are rounded; the final score uses engine precision.</p></div>}
          </>}
        </aside>}
      </div>
    </main>
    <footer className="footer"><span>Public sources. Original authors. Traceable ranking.</span><span>Press <kbd>/</kbd> to search</span></footer>
  </div>;
}

createRoot(document.getElementById("root")!).render(<App />);
