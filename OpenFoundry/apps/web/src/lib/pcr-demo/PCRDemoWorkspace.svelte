<script lang="ts">
  import Icon from '$lib/lab/Icon.svelte';
  import type { SessionInfo } from '$lib/preflight/types';
  import type { PCRDemoDetail, PCRAnalysis, PCRRound } from './types';
  import './pcr-demo.css';

  let { session }: { session: SessionInfo | null } = $props();
  type Stage = 'input' | 'analysis' | 'findings' | 'experiments' | 'results';
  type Observation = { run_id: string; sample_id: string; condition: string; target_signal: number; background_signal: number; control_type: string };
  type OptionId = 'specificity' | 'consistency' | 'independent-repeat';
  type ExperimentOption = { id: OptionId; title: string; question: string; rationale: string; required_data: string; recommended: boolean };
  type AnalysisView = { id: string; round: number; headline: string; interpretation: string; why_changed: string | null; observations: string[]; limitations: string[]; suggestion: string; steps: { title: string; detail: string }[]; metrics: { label: string; value: string; detail: string }[]; options: ExperimentOption[]; created_at: string };
  type DetailView = { id: string; title: string; question: string; analyses: AnalysisView[]; rows: Observation[]; evidence_name: string; selected_option: OptionId | null; selected_title: string; selection_id: string | null; evidence_hash: string };
  type InvestigationSummary = { id: string; title: string };
  const sourceHash = 'a5cda7064aba2db5449a195c8112779b4f8173593fc67c2d51096cf5f4c5feaf';
  const sourceUrl = '/pcr-demo/PCR_protocol.pdf';
  const columnNames = 'run_id,sample_id,condition,target_signal,background_signal,control_type';
  const stages: { id: Stage; label: string }[] = [{ id: 'input', label: 'Input' }, { id: 'analysis', label: 'Analysis' }, { id: 'findings', label: 'Interpretation' }, { id: 'experiments', label: 'Next experiment' }, { id: 'results', label: 'New evidence' }];
  let stage = $state<Stage>('input');
  let title = $state('A clearer PCR signal');
  let question = $state('Which follow-up would best improve confidence in the quality of this PCR signal?');
  let csv = $state('');
  let filename = $state('');
  let rows = $state<Observation[]>([]);
  let dataKind = $state('');
  let pdfVerified = $state(false);
  let busy = $state('');
  let error = $state('');
  let detail = $state<DetailView | null>(null);
  let serverDetail = $state<PCRDemoDetail | null>(null);
  let investigations = $state<InvestigationSummary[]>([]);
  let loadedSession = $state('');
  let candidate = $state<OptionId | null>(null);
  let selectionAcknowledged = $state(false);
  let createKey = $state('');
  let resultsKey = $state('');
  let selectionKey = $state('');
  let csvInput: HTMLInputElement;
  let pdfInput: HTMLInputElement;
  let heading: HTMLDivElement;
  const latest = $derived(detail?.analyses.at(-1));
  const analysisReady = $derived(!!serverDetail?.current_round.analysis);
  const previous = $derived(detail && detail.analyses.length > 1 ? detail.analyses.at(-2) : undefined);
  const selectedCard = $derived(latest?.options.find(option => option.id === candidate));
  const maxSignal = $derived(Math.max(1, ...rows.map(row => Math.max(row.target_signal, row.background_signal))));
  const specimenCount = $derived(rows.filter(row => row.control_type === 'none').length);
  const controlCount = $derived(rows.filter(row => row.control_type !== 'none').length);
  const fmt = (value: number) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value);
  const when = (value: string) => new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  function analysisView(analysis: PCRAnalysis, round: PCRRound): AnalysisView {
    const metrics = analysis.metrics;
    return {
      id: analysis.id, round: round.number, headline: analysis.headline, interpretation: analysis.interpretation, why_changed: analysis.why_changed,
      observations: analysis.observations, limitations: analysis.limitations, suggestion: analysis.recommendation,
      steps: analysis.steps, created_at: analysis.created_at,
      metrics: [
        { label: 'Mean target signal', value: `${fmt(metrics.target_mean)} AU`, detail: `${metrics.specimen_count} specimen observations; controls excluded from the mean.` },
        { label: 'Background / target', value: metrics.background_ratio_percent === null ? 'Undefined' : `${fmt(metrics.background_ratio_percent)}%`, detail: 'Mean background divided by mean target signal.' },
        { label: 'Between-specimen variation', value: metrics.target_cv_percent === null ? 'Undefined' : `${fmt(metrics.target_cv_percent)}% CV`, detail: 'Descriptive coefficient of variation; no causal or statistical significance claim.' }
      ],
      options: analysis.options.map(option => ({ id: option.id, title: option.title, question: option.question, rationale: `${option.rationale} ${option.expected_learning}`, required_data: `Specimen target and background signals plus positive and negative controls. ${option.tradeoff}`, recommended: option.recommended }))
    };
  }
  function adopt(raw: PCRDemoDetail) {
    serverDetail = raw;
    const current = raw.current_round;
    detail = {
      id: raw.investigation.id, title: raw.investigation.title, question: raw.investigation.question,
      analyses: raw.rounds.flatMap(round => round.analysis ? [analysisView(round.analysis, round)] : []),
      rows: current.rows, evidence_name: current.filename, evidence_hash: current.content_hash,
      selected_option: current.selection?.status === 'selected' ? current.selection.option_id : null,
      selected_title: current.selection?.title ?? '', selection_id: current.selection?.status === 'selected' ? current.selection.id : null
    };
  }

  async function api<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`/api/lab/pcr-demo${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session?.csrf_token ?? '' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message ?? 'This action could not be completed.');
    return data as T;
  }
  function parsePreview(text: string) {
    const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    if (lines[0]?.trim() !== columnNames) throw new Error(`Use the six expected CSV columns: ${columnNames}.`);
    if (lines.length < 2 || lines.length > 102) throw new Error('Choose a CSV containing observations, with no more than 100 data rows.');
    return lines.slice(1).map((line, index) => {
      const parts = line.split(',').map(part => part.trim());
      if (parts.length !== 6 || !['none', 'positive', 'negative'].includes(parts[5]) || !parts[3] || !parts[4] || !Number.isFinite(Number(parts[3])) || !Number.isFinite(Number(parts[4]))) throw new Error(`Check observation row ${index + 2}: signals must be numbers and control_type must be none, positive or negative.`);
      return { run_id: parts[0], sample_id: parts[1], condition: parts[2], target_signal: Number(parts[3]), background_signal: Number(parts[4]), control_type: parts[5] };
    });
  }
  function go(next: Stage) { stage = next; error = ''; heading?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function fresh() { detail = null; serverDetail = null; csv = ''; filename = ''; rows = []; dataKind = ''; candidate = null; selectionAcknowledged = false; pdfVerified = false; createKey = ''; resultsKey = ''; selectionKey = ''; go('input'); }
  async function loadList() {
    try { const result = await api<{ investigations: InvestigationSummary[] }>('/investigations?project_id=demo-lab'); investigations = result.investigations; }
    catch (e) { error = (e as Error).message; }
  }
  $effect(() => { if (session && loadedSession !== session.user.id) { loadedSession = session.user.id; void loadList(); } });
  async function openInvestigation(id: string) {
    if (!id) return;
    busy = 'Opening saved investigation'; error = '';
    try {
      adopt(await api<PCRDemoDetail>(`/investigations/${id}`));
      if (!detail) return;
      createKey = ''; resultsKey = ''; selectionKey = '';
      title = detail.title; question = detail.question; candidate = detail.selected_option;
      rows = detail.rows; filename = detail.evidence_name; csv = ''; dataKind = 'Saved source-linked evidence';
      go(analysisReady ? 'findings' : 'analysis');
    } catch (e) { error = (e as Error).message; } finally { busy = ''; }
  }
  async function loadFictional() {
    busy = 'Reading fictional observation file'; error = '';
    try {
      const option = stage === 'results' ? detail?.selected_option : null;
      if (stage === 'results' && !option) throw new Error('Select and review an experiment before loading its results.');
      const name = option ? `${option}.csv` : 'initial.csv';
      const response = await fetch(`/pcr-demo/${name}`);
      if (!response.ok) throw new Error('The fictional observation file is unavailable.');
      const text = await response.text(); const preview = parsePreview(text);
      csv = text; filename = name; rows = preview; dataKind = 'Fictional presentation dataset'; createKey = ''; resultsKey = '';
    } catch (e) { error = (e as Error).message; } finally { busy = ''; }
  }
  async function readCsv(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    error = '';
    try {
      if (file.size > 60 * 1024) throw new Error('Choose a CSV smaller than 60 KB.');
      const text = await file.text(); const preview = parsePreview(text);
      csv = text; filename = file.name; rows = preview; dataKind = 'Uploaded presentation observations'; createKey = ''; resultsKey = '';
    } catch (e) { error = (e as Error).message; }
    (event.currentTarget as HTMLInputElement).value = '';
  }
  async function verifyPdf(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    error = ''; pdfVerified = false;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('The source PDF must be smaller than 2 MB.');
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (hash !== sourceHash) throw new Error('This file differs from the supplied PCR protocol. This presentation supports that exact source PDF.');
      pdfVerified = true;
    } catch (e) { error = (e as Error).message; }
    (event.currentTarget as HTMLInputElement).value = '';
  }
  async function analyse() {
    if (!csv.trim() && (!serverDetail || serverDetail.current_round.analysis)) return;
    busy = 'Saving evidence and calculating the analysis'; error = ''; go('analysis');
    try {
      if (!serverDetail) { createKey ||= crypto.randomUUID(); adopt(await api<PCRDemoDetail>('/investigations', { project_id: 'demo-lab', title, question, csv, filename, fictional: true, source_sha256: sourceHash, source_filename: 'PCR_protocol.pdf', idempotency_key: createKey })); }
      else if (serverDetail.current_round.analysis) { resultsKey ||= crypto.randomUUID(); adopt(await api<PCRDemoDetail>(`/investigations/${serverDetail.investigation.id}/results`, { csv, filename, fictional: true, selection_id: detail?.selection_id, idempotency_key: resultsKey })); }
      if (!serverDetail) throw new Error('The investigation could not be saved.');
      adopt(await api<PCRDemoDetail>(`/investigations/${serverDetail.investigation.id}/analyse`, {}));
      csv = ''; candidate = null; selectionAcknowledged = false; resultsKey = ''; selectionKey = ''; await loadList();
    } catch (e) { error = (e as Error).message; } finally { busy = ''; }
  }
  async function selectExperiment() {
    if (detail?.selection_id && candidate === detail.selected_option) { go('results'); return; }
    if (!detail || !candidate || !selectionAcknowledged) return;
    busy = 'Saving your reviewed experiment choice'; error = '';
    try {
      selectionKey ||= crypto.randomUUID();
      adopt(await api<PCRDemoDetail>(`/investigations/${detail.id}/select`, { option_id: candidate, round_id: serverDetail?.current_round.id, analysis_id: serverDetail?.current_round.analysis?.id, acknowledged: true, idempotency_key: selectionKey }));
      csv = ''; filename = ''; rows = []; dataKind = ''; go('results');
    } catch (e) { error = (e as Error).message; } finally { busy = ''; }
  }
</script>

<div class="pcr-demo">
  <div class="pcr-toolbar">
    <span class="pcr-mode"><i></i>Fictional scenario · calculated analysis</span>
    <div class="pcr-toolbar-actions">
      {#if investigations.length}<label><span class="pcr-screenreader">Open a saved investigation</span><select value={detail?.id ?? ''} disabled={!!busy} onchange={event => openInvestigation(event.currentTarget.value)}><option value="">Saved investigations</option>{#each investigations as investigation}<option value={investigation.id}>{investigation.title}</option>{/each}</select></label>{/if}
      <button class="text-button" disabled={!!busy} onclick={fresh}><Icon name="plus" size={14} />New presentation</button>
    </div>
  </div>
  <nav class="pcr-stepper" aria-label="Investigation stages">{#each stages as item, index}<button class:active={stage === item.id} class:complete={stages.findIndex(step => step.id === stage) > index} aria-current={stage === item.id ? 'step' : undefined} disabled={!!busy || (item.id !== 'input' && item.id !== 'analysis' && !analysisReady) || (item.id === 'analysis' && !serverDetail) || (item.id === 'results' && !detail?.selection_id)} onclick={() => go(item.id)}><b>{index + 1}</b><span>{item.label}</span></button>{/each}</nav>
  {#if error}<div class="pcr-alert" role="alert"><span>{error}</span><button aria-label="Dismiss error" onclick={() => error = ''}><Icon name="close" size={16} /></button></div>{/if}
  <div bind:this={heading} tabindex="-1"></div>
  <input class="pcr-screenreader" type="file" accept=".csv,text/csv" bind:this={csvInput} onchange={readCsv} aria-label="Upload observation CSV" />
  <input class="pcr-screenreader" type="file" accept=".pdf,application/pdf" bind:this={pdfInput} onchange={verifyPdf} aria-label="Verify supplied PCR protocol" />

  {#if stage === 'input'}
    <section class="pcr-panel">
      <div class="pcr-panel-body">
        <div class="pcr-heading"><span class="section-kicker">Start with the evidence</span><h2>One result. Several possible explanations.</h2><p>A fictional routine PCR run shows a target signal, substantial background and uneven specimen signals. Give LabRelax the question and the observations it should investigate.</p></div>
        <div class="pcr-input-grid">
          <div>
            <label>Investigation title<input type="text" bind:value={title} maxlength="160" disabled={!!busy || !!detail} /></label>
            <label>What would you like to understand?<textarea bind:value={question} rows="3" maxlength="1000" disabled={!!busy || !!detail}></textarea></label>
            <div class="pcr-source"><div class="pcr-source-top"><Icon name="link" size={21} /><div><strong>Routine PCR with OneTaq® DNA Polymerase</strong><span>Supplied source protocol · NEB · 3 pages</span></div></div><p>The genuine protocol provides laboratory context. The measurements below are separate, fictional observations; they were not extracted from this PDF.</p><div class="pcr-source-links"><a href={sourceUrl} target="_blank" rel="noreferrer">View source <Icon name="arrow" size={13} /></a><a href={sourceUrl} download="PCR_protocol.pdf">Download PDF <Icon name="download" size={13} /></a><button class="text-button" disabled={!!busy} onclick={() => pdfInput.click()}>Verify your copy</button></div>{#if pdfVerified}<div class="pcr-file-note"><Icon name="check" size={14} />Your PDF matches the supplied source.</div>{/if}<details><summary>Source identity</summary><code>SHA-256 {sourceHash}</code><p>The source is retained unchanged. This demo does not propose operational changes to the protocol.</p></details></div>
            <div class="pcr-upload"><Icon name="download" size={23} /><strong>Add the observation data</strong><p>Load the labelled fictional dataset, or upload a CSV in the supported format.</p><div class="pcr-actions"><button class="primary" disabled={!!busy || !session || !!detail} onclick={loadFictional}>Load fictional input <Icon name="plus" size={14} /></button><button class="secondary" disabled={!!busy || !session || !!detail} onclick={() => csvInput.click()}>Upload CSV</button></div><a class="text-button" href="/pcr-demo/initial.csv" download>Download example CSV <Icon name="download" size={13} /></a></div>
          </div>
          <div>
            <div class="pcr-input-explainer"><span class="section-kicker">What the input means</span><h3>Post-PCR signals, ready to compare.</h3><p>Each row represents one specimen or control. Target signal and background are illustrative band intensities in arbitrary units. Higher target signal is interpreted alongside background and variation between specimens.</p><div class="pcr-mini-stats"><div><strong>{rows.length ? specimenCount : '6'}</strong><span>specimens</span></div><div><strong>{rows.length ? controlCount : '2'}</strong><span>controls</span></div><div><strong>AU</strong><span>signal units</span></div></div><p>This is a fictional research demonstration. These are not qPCR cycle thresholds or clinical measurements.</p></div>
            {#if rows.length}<div class="pcr-data-summary"><div><strong>{filename}</strong><span>{dataKind} · {rows.length} rows ready</span></div><Icon name="check" size={19} /></div><div class="pcr-table-wrap"><table><thead><tr><th>Sample</th><th>Condition</th><th>Target</th><th>Background</th></tr></thead><tbody>{#each rows as row}<tr class:pcr-control-row={row.control_type !== 'none'}><td>{row.sample_id}{row.control_type !== 'none' ? ` · ${row.control_type}` : ''}</td><td>{row.condition}</td><td>{fmt(row.target_signal)}</td><td>{fmt(row.background_signal)}</td></tr>{/each}</tbody></table></div>{:else}<div class="pcr-chart"><p>Load data to inspect the exact observations before analysing them.</p></div>{/if}
          </div>
        </div>
      </div>
      <div class="pcr-panel-footer"><p>Source-linked evidence. Calculations on the actual uploaded values.</p><button class="primary" disabled={!!busy || !session || (!csv && !detail) || !title.trim() || !question.trim()} onclick={() => detail ? go(analysisReady ? 'findings' : 'analysis') : analyse()}>{detail ? 'Review saved evidence' : 'Analyse the evidence'} <Icon name="arrow" size={15} /></button></div>
    </section>
  {:else if stage === 'analysis'}
    <section class="pcr-panel"><div class="pcr-panel-body"><div class="pcr-heading"><span class="section-kicker">Inside the investigation</span><h2>{busy ? 'Reading the evidence.' : error ? 'Analysis needs attention.' : analysisReady ? 'The analysis is ready.' : 'Ready to analyse the evidence.'}</h2><p>LabRelax checks the source, calculates descriptive signals and prepares the next questions. Completed checks below come from the saved analysis.</p></div><div class="pcr-analysis-layout"><div><div class="pcr-analysis-state" role="status"><span>{#if busy}<span class="spinner"></span>{:else}<Icon name="check" size={21} />{/if}</span><div><h3>{busy || (error ? 'Analysis needs attention' : analysisReady ? 'Analysis saved' : 'Evidence saved')}</h3><p>{busy ? 'Calculating from your supplied observations.' : latest ? `Round ${latest.round} · ${filename || detail?.evidence_name}` : 'Return to the input to check your evidence.'}</p></div></div><div class="pcr-checks">{#each !busy && analysisReady ? latest?.steps ?? [] : [] as step}<div class="pcr-check"><span class="pcr-check-mark"><Icon name="check" size={17} /></span><div><strong>{step.title}</strong><p>{step.detail}</p></div></div>{/each}</div></div><aside class="pcr-analysis-aside"><span class="section-kicker">The research question</span><p class="pcr-question">{detail?.question ?? question}</p><p>Interpretations follow the calculated values. Alternative result files can produce a different recommendation.</p><p>Fixed demonstration rules are used here; no live language-model reasoning is claimed.</p></aside></div></div><div class="pcr-panel-footer"><p>{latest ? 'Explore the interpretation when you are ready.' : 'Your original evidence is retained.'}</p>{#if !busy && !analysisReady && serverDetail}<button class="secondary" onclick={analyse}>Retry saved analysis <Icon name="reset" size={14} /></button>{/if}<button class="primary" disabled={!!busy || !analysisReady} onclick={() => go('findings')}>View findings <Icon name="arrow" size={15} /></button></div></section>
  {:else if stage === 'findings' && latest}
    <section class="pcr-panel"><div class="pcr-panel-body"><span class="pcr-round">Investigation round {latest.round}</span><div class="pcr-finding-hero"><span class="section-kicker">What the evidence suggests</span><h2>{latest.headline}</h2><p>{latest.interpretation}</p></div><div class="pcr-metrics">{#each latest.metrics as metric}<div class="pcr-metric"><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small></div>{/each}</div><div class="pcr-reasoning"><article><span class="section-kicker">What we observed</span><h3>The evidence behind this interpretation.</h3><ul class="pcr-list">{#each latest.observations as observation}<li><Icon name="check" size={14} /><span>{observation}</span></li>{/each}</ul></article><article><span class="section-kicker">What we should do next</span><h3>{latest.suggestion}</h3><p>Choose the follow-up that best distinguishes the remaining explanations. Each option makes a different question testable.</p><details class="pcr-history"><summary>Limits of this interpretation</summary><ul class="pcr-list">{#each latest.limitations as limitation}<li><span>{limitation}</span></li>{/each}</ul></details></article></div>{#if previous}<div class="pcr-comparison"><span class="section-kicker">Research memory</span><h3>New evidence. An updated direction.</h3>{#if latest.why_changed}<p>{latest.why_changed}</p>{/if}<div class="pcr-comparison-grid"><div><span>Round {previous.round} · previous interpretation</span><p>{previous.headline}</p></div><Icon name="arrow" size={22} /><div><span>Round {latest.round} · after the new results</span><p>{latest.headline}</p></div></div></div>{/if}{#if detail}<details class="pcr-history"><summary>View the investigation history · {detail.analyses.length} saved {detail.analyses.length === 1 ? 'analysis' : 'analyses'}</summary><ol>{#each detail.analyses as analysis}<li><strong>Round {analysis.round} · {when(analysis.created_at)}</strong><p>{analysis.headline}</p></li>{/each}</ol><small class="pcr-fine">Latest evidence SHA-256: {detail.evidence_hash}</small></details>{/if}</div><div class="pcr-panel-footer"><button class="text-button" onclick={() => go('analysis')}>Review completed checks</button><button class="primary" onclick={() => { candidate = detail?.selected_option ?? null; selectionAcknowledged = !!detail?.selection_id; go('experiments'); }}>Explore experiment options <Icon name="arrow" size={15} /></button></div></section>
  {:else if stage === 'experiments' && latest}
    <section class="pcr-panel"><div class="pcr-panel-body"><div class="pcr-heading"><span class="section-kicker">Make the next experiment informative</span><h2>Three questions. Choose one to pursue.</h2><p>These fictional extensions compare possible research directions. Review the question and the evidence each would add before selecting an option.</p></div><div class="pcr-option-grid">{#each latest.options as option}<article class="pcr-option" class:recommended={option.recommended} class:selected={candidate === option.id}><div class="pcr-option-label"><span>{option.recommended ? 'Suggested by the analysis' : 'Alternative direction'}</span><Icon name={candidate === option.id ? 'check' : 'flask'} size={17} /></div><h3>{option.title}</h3><p>{option.question}</p><dl><dt>What this could tell us</dt><dd>{option.rationale}</dd><dt>Evidence to bring back</dt><dd>{option.required_data}</dd></dl><button class="secondary" disabled={!!busy || (!!detail?.selection_id && detail.selected_option !== option.id)} onclick={() => { candidate = option.id; selectionAcknowledged = false; selectionKey = ''; }}>{detail?.selected_option === option.id ? 'Reviewed choice' : candidate === option.id ? 'Selected for review' : 'Explore this option'}<Icon name={candidate === option.id ? 'check' : 'arrow'} size={14} /></button></article>{/each}</div>{#if selectedCard}<div class="pcr-selection"><span class="section-kicker">Your selected direction</span><h3>{selectedCard.title}</h3><p>{selectedCard.question}</p>{#if detail?.selection_id}<p class="pcr-fine">This choice has been reviewed and saved. Add its results to continue, or start a new presentation to explore an independent branch.</p>{:else}<label class="pcr-checkbox"><input type="checkbox" bind:checked={selectionAcknowledged} /><span>I have reviewed this fictional research direction and will attach the next observation file to this choice.</span></label>{/if}<button class="primary" disabled={!!busy || (!selectionAcknowledged && !detail?.selection_id)} onclick={selectExperiment}>{busy || (detail?.selection_id ? 'Continue to results' : 'Confirm choice and add results')}<Icon name="arrow" size={14} /></button></div>{/if}<small class="pcr-fine">Material readiness: not assessed — PCR stock and template quantities were not supplied. These options do not change the source protocol or operate laboratory equipment.</small></div><div class="pcr-panel-footer"><button class="text-button" onclick={() => go('findings')}>Back to the interpretation</button><p>The scientist chooses the next direction.</p></div></section>
  {:else if stage === 'results' && detail?.selection_id}
    <section class="pcr-panel"><div class="pcr-panel-body"><div class="pcr-heading"><span class="section-kicker">Close the learning loop</span><h2>Bring the next result back.</h2><p>The results will be linked to your selected experiment. LabRelax will compare the new evidence with its earlier interpretation and prepare updated options.</p></div><div class="pcr-input-grid"><div><div class="pcr-input-explainer"><span class="section-kicker">Reviewed experiment choice</span><h3>{detail.selected_title}</h3><p>Results remain hypothetical in this presentation. Loading a fictional file does not imply that a physical experiment has been performed.</p></div><div class="pcr-upload"><Icon name="download" size={23} /><strong>Add the next observations</strong><p>Use the fictional outcome prepared for this experiment, or supply compatible observation data.</p><div class="pcr-actions"><button class="primary" disabled={!!busy} onclick={loadFictional}>Load fictional results <Icon name="plus" size={14} /></button><button class="secondary" disabled={!!busy} onclick={() => csvInput.click()}>Upload results CSV</button></div>{#if detail.selected_option}<a class="text-button" href={`/pcr-demo/${detail.selected_option}.csv`} download>Download this fictional outcome <Icon name="download" size={13} /></a>{/if}</div><small class="pcr-fine">Expected columns: {columnNames}. Keep specimen and control identities explicit. The server validates observations before analysis.</small></div><div>{#if rows.length}<div class="pcr-data-summary"><div><strong>{filename}</strong><span>{dataKind} · {rows.length} observations</span></div><Icon name="check" size={19} /></div><div class="pcr-chart" aria-label="Target and background signals in the uploaded result">{#each rows as row}<div class="pcr-chart-row"><span>{row.sample_id}</span><div class="pcr-bars"><i style={`width:${row.target_signal / maxSignal * 100}%`}></i><b style={`width:${row.background_signal / maxSignal * 100}%`}></b></div><span>{fmt(row.target_signal)}</span></div>{/each}</div><div class="pcr-chart-legend"><span><i></i>Target signal</span><span><i></i>Background</span></div><details class="pcr-history"><summary>Inspect the exact observation values</summary><div class="pcr-table-wrap"><table><thead><tr><th>Sample</th><th>Condition</th><th>Target</th><th>Background</th></tr></thead><tbody>{#each rows as row}<tr><td>{row.sample_id}</td><td>{row.condition}</td><td>{fmt(row.target_signal)}</td><td>{fmt(row.background_signal)}</td></tr>{/each}</tbody></table></div></details>{:else}<div class="pcr-input-explainer"><h3>The next answer starts with new evidence.</h3><p>Load results to preview the observations. The revised interpretation is calculated after you submit them.</p></div>{/if}</div></div></div><div class="pcr-panel-footer"><button class="text-button" onclick={() => go('experiments')}>Review experiment options</button><button class="primary" disabled={!!busy || !csv} onclick={analyse}>Analyse new evidence <Icon name="reset" size={15} /></button></div></section>
  {/if}
</div>
