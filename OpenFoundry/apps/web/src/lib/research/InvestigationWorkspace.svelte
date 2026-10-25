<script lang="ts">
  import Icon from '$lib/lab/Icon.svelte';
  import type { ProtocolDraft, SessionInfo } from '$lib/preflight/types';
  import type { AgentRun, EvidenceKind, Investigation, InvestigationDetail, ResearchEvidence } from './types';
  import './research.css';

  let { session, approvedProtocol = null, onReviewProtocol, onViewPlan }: {
    session: SessionInfo | null;
    approvedProtocol?: ProtocolDraft | null;
    onReviewProtocol: () => void;
    onViewPlan?: (experimentId: string) => void;
  } = $props();
  let investigations = $state<Investigation[]>([]);
  let detail = $state<InvestigationDetail | null>(null);
  let selectedId = $state('');
  let title = $state('A promising signal. A better next experiment.');
  let goal = $state('Is this apparent sample effect real, or caused by measurement order?');
  let protocols = $state<ProtocolDraft[]>([]);
  let selectedProtocolId = $state('');
  let designAcknowledged = $state(false);
  let proposalAcknowledged = $state(false);
  let rationale = $state('Counterbalance the two sample groups across measurement order while retaining all eight specimens, two fixed controls and the reviewed SOP quantities.');
  let busy = $state('');
  let error = $state('');
  let notice = $state('');
  let loadedSession = $state('');
  let loadedProtocol = $state('');
  let phase = $state<'initial' | 'followup'>('initial');
  let kind = $state<EvidenceKind>('synthetic_observation');
  let uploadFile = $state<File | null>(null);
  let evidenceNote = $state('');
  let linkedExperiment = $state('');
  let pendingRunId = $state('');
  let pendingRunKey = $state('');
  let activeEvidenceId = $state('');
  const projectId = 'demo-lab';
  // The supported manifest is explicit and is checked for exact equality by the server on review.
  const proposedAssignments = ['A-1','B-1','B-2','A-2','B-3','A-3','A-4','B-4','CTRL-1','CTRL-2'].map((specimen_id, index) => ({ specimen_id, sample_group: specimen_id.startsWith('CTRL') ? 'CONTROL' : specimen_id[0], measurement_order: index + 1, is_control: specimen_id.startsWith('CTRL') }));
  const latestAnalysis = $derived(detail?.analyses.toSorted((a, b) => a.created_at.localeCompare(b.created_at)).at(-1));
  const latestRevision = $derived(detail?.revisions.toSorted((a, b) => a.revision - b.revision).at(-1));
  const previousRevision = $derived.by(() => {
    const current = latestRevision;
    if (!detail || !current) return undefined;
    const evidenceSnapshot = JSON.stringify([...current.evidence_ids].sort());
    return detail.revisions.toSorted((a, b) => b.revision - a.revision).find(item => item.revision < current.revision && JSON.stringify([...item.evidence_ids].sort()) !== evidenceSnapshot);
  });
  const proposal = $derived(detail?.proposals.toSorted((a, b) => a.created_at.localeCompare(b.created_at)).at(-1));
  const latestRun = $derived(detail?.runs.toSorted((a, b) => a.created_at.localeCompare(b.created_at)).at(-1));
  const displayedEvidence = $derived(detail?.evidence.find(item => item.id === activeEvidenceId) ?? detail?.evidence.toSorted((a, b) => a.imported_at.localeCompare(b.imported_at)).at(-1));
  const plotRows = $derived(displayedEvidence?.rows.filter(row => !row.is_control) ?? []);
  const plotMin = $derived(Math.min(...plotRows.map(row => row.signal), 0));
  const plotMax = $derived(Math.max(...plotRows.map(row => row.signal), 1));
  const plotGroups = $derived([...new Set(plotRows.map(row => row.sample_group))]);
  const selectedProtocol = $derived(protocols.find(item => item.id === selectedProtocolId));
  const currentEvidence = $derived.by(() => {
    if (!detail) return undefined;
    const evidencePhase = detail.evidence.some(item => item.phase === 'followup') ? 'followup' : 'initial';
    return detail.evidence.filter(item => item.phase === evidencePhase).toSorted((a, b) => a.imported_at.localeCompare(b.imported_at)).at(-1);
  });
  const proposalEvidenceStale = $derived(!!(proposal && currentEvidence && !proposal.evidence_ids.includes(currentEvidence.id)));
  const analysisEvidenceStale = $derived(!!(latestAnalysis && currentEvidence && !latestAnalysis.evidence_ids.includes(currentEvidence.id)));
  const pendingFollowup = $derived(detail?.evidence.some(item => item.phase === 'followup') ?? false);
  const num = (value: number | string | null | undefined) => value == null ? '—' : new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 }).format(Number(value));
  const when = (value: string) => new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const supportLabel = (value: string) => ({ unresolved: 'Unresolved', weakened: 'Weakened', provisionally_supported: 'Provisionally supported' }[value] ?? value.replaceAll('_', ' '));
  const displayTool = (tool: string) => ({ read_evidence: 'Read observations and history', analyse_results: 'Compared groups and measurement order', analyze_results: 'Compared groups and measurement order', inspect_design: 'Inspected reviewed design', preview_materials: 'Checked recorded materials', save_proposal: 'Saved the proposed next step', check_materials: 'Checked recorded materials', save_recommendation: 'Saved the proposed next step' }[tool] ?? tool.replaceAll('_', ' '));

  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.method && init.method !== 'GET') headers.set('X-CSRF-Token', session?.csrf_token ?? '');
    const response = await fetch(`/api/lab${path}`, { ...init, headers });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message ?? 'The request could not be completed.');
    return data as T;
  }
  const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  async function refreshDetail(id = selectedId) {
    if (!id) return;
    detail = await api<InvestigationDetail>(`/investigations/${id}`);
    selectedId = id;
  }
  async function loadProtocols() {
    const data = await api<{ protocols: ProtocolDraft[] }>(`/protocols?project_id=${projectId}`);
    protocols = data.protocols.filter(item => item.status === 'approved');
    if (approvedProtocol?.status === 'approved') selectedProtocolId = approvedProtocol.id;
    else if (!selectedProtocolId) selectedProtocolId = detail?.investigation.protocol_id ?? protocols[0]?.id ?? '';
  }
  async function loadWorkspace() {
    busy = 'Opening your investigation'; error = '';
    try {
      const data = await api<{ investigations: Investigation[] }>(`/investigations?project_id=${projectId}`);
      investigations = data.investigations;
      if (investigations.length) await refreshDetail(selectedId || investigations[0].id);
      await loadProtocols();
    } catch (e) { error = (e as Error).message; }
    finally { busy = ''; }
  }
  $effect(() => {
    if (session && loadedSession !== session.user.id) { loadedSession = session.user.id; void loadWorkspace(); }
  });
  $effect(() => {
    if (session && approvedProtocol?.status === 'approved' && loadedProtocol !== approvedProtocol.id) {
      loadedProtocol = approvedProtocol.id; void loadProtocols().catch(e => error = e.message);
    }
  });
  async function createInvestigation() {
    busy = 'Saving your research question'; error = '';
    try {
      const investigation = await api<Investigation>('/investigations', json({ project_id: projectId, title, goal }));
      investigations = [investigation, ...investigations];
      await refreshDetail(investigation.id); activeEvidenceId = ''; pendingRunId = ''; pendingRunKey = '';
      notice = 'Investigation saved. Add the original observations to begin.';
    } catch (e) { error = (e as Error).message; }
    finally { busy = ''; }
  }
  async function selectInvestigation(id: string) {
    busy = 'Opening investigation'; error = ''; activeEvidenceId = ''; pendingRunId = ''; pendingRunKey = '';
    try { await refreshDetail(id); selectedProtocolId = detail?.investigation.protocol_id ?? protocols[0]?.id ?? ''; }
    catch (e) { error = (e as Error).message; }
    finally { busy = ''; }
  }
  async function importEvidence(csv: string, filename: string, importPhase: 'initial' | 'followup', note: string, importKind = kind) {
    if (!selectedId) return;
    busy = 'Saving source-linked observations'; error = '';
    try {
      const evidence = await api<ResearchEvidence>(`/investigations/${selectedId}/evidence`, json({ phase: importPhase, kind: importKind, filename, csv, note, protocol_version: selectedProtocol?.version ?? detail?.investigation.design?.protocol_version ?? '1.0', ...(linkedExperiment.trim() ? { experiment_id: linkedExperiment.trim() } : {}) }));
      await refreshDetail(); activeEvidenceId = evidence.id; uploadFile = null;
      notice = 'Observations saved with their original source. Inventory is unchanged.';
      if (importPhase === 'followup') { busy = ''; await investigate(true); }
    } catch (e) { error = (e as Error).message; }
    finally { busy = ''; }
  }
  async function importFile() {
    if (!uploadFile) return;
    if (uploadFile.size > 60 * 1024) { error = 'Choose a CSV smaller than 60 KB to fit the supported 64 KB request limit.'; return; }
    await importEvidence(await uploadFile.text(), uploadFile.name, phase, evidenceNote);
  }
  async function useCompanion(importPhase: 'initial' | 'followup') {
    busy = 'Opening synthetic companion data'; error = '';
    try {
      const filename = importPhase === 'initial' ? 'synthetic-initial.csv' : 'synthetic-followup.csv';
      const response = await fetch(`/research-companion/${filename}`);
      if (!response.ok) throw new Error('The companion dataset is unavailable. Import the agreed CSV instead.');
      await importEvidence(await response.text(), filename, importPhase, 'Explicitly synthetic companion observations for the hackathon walkthrough. No physical experiment was performed by the application.', 'synthetic_observation');
    } catch (e) { error = (e as Error).message; busy = ''; }
  }
  async function pollRun(runId: string) {
    const start = Date.now();
    while (Date.now() - start < 65000) {
      const run = await api<AgentRun>(`/investigations/${selectedId}/runs/${runId}`);
      await refreshDetail();
      if (run.status !== 'running') {
        pendingRunId = ''; pendingRunKey = '';
        if (run.status === 'failed') throw new Error(run.error ?? 'The investigation run could not finish. Completed tool outputs have been retained.');
        notice = 'Analysis and the next step are saved. Review the evidence and proposed action.';
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    notice = 'This run is still processing. Use Check progress to resume polling the same saved run.';
  }
  async function investigate(newRun = false) {
    if (!selectedId) return;
    busy = pendingRunId && !newRun ? 'Checking saved investigation progress' : 'Examining evidence and preparing the next step'; error = '';
    try {
      if (newRun || !pendingRunId) {
        pendingRunKey ||= crypto.randomUUID();
        const run = await api<AgentRun>(`/investigations/${selectedId}/runs`, json({ idempotency_key: pendingRunKey }));
        pendingRunId = run.id;
      }
      await pollRun(pendingRunId);
    } catch (e) { error = (e as Error).message; }
    finally { busy = ''; }
  }
  async function reviewDesign() {
    if (!selectedProtocolId || !designAcknowledged) return;
    busy = 'Saving your reviewed follow-up design'; error = '';
    try {
      await api<Investigation>(`/investigations/${selectedId}/design/review`, json({ protocol_id: selectedProtocolId, acknowledged: true, rationale, assignments: proposedAssignments }));
      await refreshDetail(); pendingRunId = ''; pendingRunKey = ''; designAcknowledged = false;
      notice = 'Full counterbalanced design reviewed. Investigate again to prepare its material plan.';
    } catch (e) { error = (e as Error).message; }
    finally { busy = ''; }
  }
  async function reviewProposal() {
    if (!proposal || !proposalAcknowledged || proposalEvidenceStale) return;
    busy = 'Rechecking materials and recording your review'; error = '';
    try {
      await api(`/investigations/${selectedId}/proposals/${proposal.id}/review`, json({ acknowledged: true }));
      await refreshDetail(); proposalAcknowledged = false;
      notice = 'Proposal review saved against refreshed recorded inventory. Actual use remains a separate action.';
    } catch (e) { error = (e as Error).message; }
    finally { busy = ''; }
  }
</script>

<div class="research-workspace">
  {#if error}<div class="research-alert" role="alert"><strong>Action needs attention</strong><p>{error}</p><button class="text-button" onclick={() => error = ''}>Dismiss</button></div>{/if}
  {#if notice}<div class="research-notice" role="status"><Icon name="check" size={16} />{notice}</div>{/if}
  {#if busy}<div class="research-progress" role="status"><span class="spinner"></span>{busy}…</div>{/if}
  {#if investigations.length}
    <div class="research-toolbar"><label>Investigation<select value={selectedId} onchange={event => selectInvestigation(event.currentTarget.value)} disabled={!!busy}>{#each investigations as item}<option value={item.id}>{item.title}</option>{/each}</select></label><button class="secondary compact" disabled={!!busy} onclick={() => { detail = null; selectedId = ''; }}>New investigation <Icon name="plus" size={14} /></button>{#if detail}<button class="text-button" disabled={!!busy} onclick={() => refreshDetail().catch(e => error = e.message)}>Refresh evidence <Icon name="reset" size={13} /></button>{/if}</div>
  {/if}
  {#if !detail}
    <section class="research-start panel"><div class="research-start-copy"><span class="section-kicker">FROM A PROMISING RESULT TO AN INFORMATIVE EXPERIMENT</span><h2>What should we<br />learn next?</h2><p>Bring an observation. Explore competing explanations. Prepare a test your lab can actually run.</p><div class="research-principle"><Icon name="link" size={18} /><span>Every interpretation stays linked to its evidence.</span></div><div class="research-principle"><Icon name="shield" size={18} /><span>You review physical designs and actual use.</span></div></div><form onsubmit={event => { event.preventDefault(); void createInvestigation(); }}><label for="investigation-title">Investigation name</label><input id="investigation-title" bind:value={title} maxlength="160" required /><label for="investigation-goal">What are you trying to learn?</label><textarea id="investigation-goal" bind:value={goal} rows="4" maxlength="2000" required></textarea><div class="research-scenario"><span class="pill neutral">SYNTHETIC WALKTHROUGH</span><p>Start with a microplate signal that could be a sample effect—or a measurement-order artefact.</p></div><button class="primary" disabled={!!busy || !session || !goal.trim() || !title.trim()} type="submit">Start investigation <Icon name="arrow" size={16} /></button></form></section>
  {:else}
    <section class="research-question panel"><div><span class="section-kicker">THE ACTIVE RESEARCH QUESTION</span><h2>{detail.investigation.goal}</h2><p>{detail.investigation.title}</p></div><span class="pill neutral">{detail.investigation.status.replaceAll('_', ' ')}</span></section>
    <div class="research-loop" aria-label="Investigation progress">{#each ['Observe', 'Explain', 'Prepare', 'Learn again'] as step, i}<span class:reached={i === 0 || (i === 1 && latestAnalysis) || (i === 2 && proposal) || (i === 3 && pendingFollowup)}><b>{String(i + 1).padStart(2, '0')}</b>{step}</span>{/each}</div>
    {#if !detail.evidence.length}
      <section class="research-observe panel"><span class="section-kicker">01 / START WITH AN OBSERVATION</span><h2>A difference worth investigating.</h2><p>Import the original results, or open the labelled synthetic companion dataset. Its eight specimens and two controls retain the measurement order needed to question the apparent difference.</p><button class="primary" disabled={!!busy} onclick={() => useCompanion('initial')}>Open synthetic initial observations <Icon name="arrow" size={16} /></button><small>Companion files are a demonstration of observations, not a performed physical experiment.</small></section>
    {/if}
    {#if analysisEvidenceStale}<div class="research-notice" role="status"><Icon name="clock" size={16} />New observations have been imported. The interpretation and plan below are historical until this evidence is analysed.</div>{/if}
    {#if latestRevision}
      <div class="research-explanations">{#each latestRevision.hypotheses as hypothesis}<article class={`research-hypothesis ${hypothesis.support}`}><div class="research-card-top"><span class="section-kicker">{hypothesis.id === 'sample-effect' ? 'EXPLANATION A' : 'EXPLANATION B'}</span><span class="pill neutral">{supportLabel(hypothesis.support)}</span></div><h3>{hypothesis.title}</h3><p>{hypothesis.reason}</p><div class="research-source-count"><Icon name="link" size={13} />Examined {latestRevision.evidence_ids.length} source · {hypothesis.supporting_evidence_ids.length} supporting · {hypothesis.contradicting_evidence_ids.length} contradicting source{hypothesis.supporting_evidence_ids.length + hypothesis.contradicting_evidence_ids.length === 1 ? '' : 's'}</div><div class="research-hypothesis-sources">{#each [...new Set([...latestRevision.evidence_ids, ...hypothesis.supporting_evidence_ids, ...hypothesis.contradicting_evidence_ids])] as evidenceId}<button class="text-button" onclick={() => activeEvidenceId = evidenceId}>{detail.evidence.find(item => item.id === evidenceId)?.filename ?? 'Inspect source evidence'} <Icon name="link" size={12} /></button>{/each}</div></article>{/each}</div>
    {/if}
    {#if displayedEvidence}
      <section class="panel research-evidence"><div class="panel-heading"><div><span class="section-kicker">01 / THE OBSERVATIONS</span><h2>{displayedEvidence.phase === 'initial' ? 'The original signal' : 'The follow-up result'}</h2><p>{displayedEvidence.filename} · {displayedEvidence.kind.replaceAll('_', ' ')} · {displayedEvidence.rows.length} rows</p></div><a class="text-button" href={`/api/lab/investigations/${selectedId}/evidence/${displayedEvidence.id}/source`}>Original CSV <Icon name="download" size={14} /></a></div>
        {#if detail.evidence.length > 1}<div class="research-evidence-switch">{#each detail.evidence as item}<button class:chosen={displayedEvidence.id === item.id} onclick={() => activeEvidenceId = item.id}>{item.phase === 'initial' ? 'Original' : 'Follow-up'} · {item.filename}</button>{/each}</div>{/if}
        <div class="research-plot-layout"><div class="research-plot"><svg viewBox="0 0 520 230" role="img" aria-label="Observed specimen signal by measurement order. Controls are excluded from this plot."><line x1="48" y1="185" x2="490" y2="185" stroke="#dbe3cf" /><line x1="48" y1="25" x2="48" y2="185" stroke="#dbe3cf" />{#each [0, 0.5, 1] as tick}<line x1="48" y1={185 - tick * 150} x2="490" y2={185 - tick * 150} stroke="#e9eee0" stroke-dasharray="3 5" /><text x="39" y={189 - tick * 150} text-anchor="end">{num(plotMin + tick * (plotMax - plotMin))}</text>{/each}{#each plotRows as row}<circle cx={58 + ((row.measurement_order - 1) / Math.max(1, Math.max(...plotRows.map(item => item.measurement_order)) - 1)) * 420} cy={185 - ((row.signal - plotMin) / (plotMax - plotMin || 1)) * 150} r="6" fill={row.sample_group === plotGroups[0] ? '#6e8757' : '#bf986c'}><title>{row.specimen_id}: {row.sample_group}, order {row.measurement_order}, signal {row.signal}, CSV row {row.source_row}</title></circle><text x={58 + ((row.measurement_order - 1) / Math.max(1, Math.max(...plotRows.map(item => item.measurement_order)) - 1)) * 420} y="202" text-anchor="middle">{row.measurement_order}</text>{/each}<text x="270" y="225" text-anchor="middle">Measurement order</text><text x="17" y="105" transform="rotate(-90 17 105)" text-anchor="middle">Signal</text></svg><div class="research-legend">{#each plotGroups as group, i}<span><i style={`background:${i === 0 ? '#6e8757' : '#bf986c'}`}></i>{group}</span>{/each}<small>Specimens shown · controls retained in source rows</small></div></div><div class="research-observation-note"><span class="section-kicker">SOURCE CONTEXT</span><p>{displayedEvidence.note || 'No additional source note supplied.'}</p><dl><dt>Imported</dt><dd>{when(displayedEvidence.imported_at)}</dd><dt>Protocol version</dt><dd>{displayedEvidence.protocol_version}</dd><dt>Existing experiment</dt><dd>{displayedEvidence.experiment_id ?? 'No historical run linked'}</dd></dl><small>SHA-256 {displayedEvidence.content_hash.slice(0, 20)}…</small></div></div>
        <details class="research-details"><summary>Inspect original rows and provenance</summary><div class="table-scroll"><table><thead><tr><th>CSV ROW</th><th>SPECIMEN</th><th>GROUP</th><th>ORDER</th><th>SIGNAL</th><th>CONTROL</th></tr></thead><tbody>{#each displayedEvidence.rows as row}<tr><td>{row.source_row}</td><td>{row.specimen_id}</td><td>{row.sample_group}</td><td>{row.measurement_order}</td><td>{num(row.signal)}</td><td>{row.is_control ? 'Yes' : 'No'}</td></tr>{/each}</tbody></table></div><pre>{displayedEvidence.original_content}</pre><p>Imported by {displayedEvidence.imported_by} · Content hash {displayedEvidence.content_hash}</p></details>
      </section>
    {/if}
    {#if detail.evidence.length}
      <section class="research-action panel"><div><span class="section-kicker">02 / EXAMINE THE EVIDENCE</span><h2>{pendingFollowup ? 'What does the new result change?' : 'Put both explanations to the test.'}</h2><p>{latestAnalysis?.output.summary ?? 'Compare group differences and measurement order before choosing the next experiment.'}</p></div><button class="primary" disabled={!!busy} onclick={() => investigate()}><Icon name="spark" size={16} />{pendingRunId ? 'Check progress' : latestAnalysis ? 'Investigate again' : 'Investigate'}</button></section>
    {/if}
    {#if latestAnalysis}<section class="research-analysis panel"><div class="panel-heading"><div><span class="section-kicker">COMPUTED FROM THE SUPPLIED OBSERVATIONS</span><h2>{latestAnalysis.output.order_confounded ? 'The original design cannot separate the explanations.' : latestAnalysis.output.next_direction}</h2><p>{latestAnalysis.tool} · version {latestAnalysis.tool_version}</p></div><span class="pill neutral">{latestAnalysis.output.classification.replaceAll('_', ' ')}</span></div><div class="research-metrics"><div><span>Unadjusted group contrast</span><strong>{num(latestAnalysis.output.raw_group_contrast)}</strong></div><div><span>Order-adjusted group contrast</span><strong>{latestAnalysis.output.rank_deficient ? 'Not identifiable' : num(latestAnalysis.output.adjusted_group_contrast)}</strong></div><div><span>Adjusted order slope</span><strong>{num(latestAnalysis.output.order_slope)}</strong></div><div><span>Design</span><strong>{latestAnalysis.output.counterbalanced ? 'Counterbalanced' : latestAnalysis.output.order_confounded ? 'Confounded' : 'Not counterbalanced'}</strong></div></div><details class="research-details"><summary>Analysis inputs, limitations and exact output</summary><p>Input evidence: {latestAnalysis.evidence_ids.join(', ')}</p><ul>{#each latestAnalysis.output.limitations as limitation}<li>{limitation}</li>{/each}</ul><pre>{JSON.stringify(latestAnalysis, null, 2)}</pre></details></section>{/if}
    {#if latestRun}<section class="research-agent panel"><div class="panel-heading"><div><span class="section-kicker">COMPLETED DESK WORK</span><h2>{latestRun.mode === 'scripted_walkthrough' ? 'Scripted walkthrough' : 'Live agent investigation'}</h2><p>{latestRun.mode === 'scripted_walkthrough' ? 'A fixed coordinator sequence invokes real analysis and material tools on your supplied data. No live model was used.' : 'A bounded model-backed coordinator uses the permitted evidence and tools.'}</p></div><span class={`pill ${latestRun.status === 'failed' ? 'red' : 'neutral'}`}>{latestRun.status}</span></div><div class="research-tools">{#each latestRun.steps as step}<details><summary><span class={`research-tool-mark ${step.status}`}>{step.status === 'completed' ? '✓' : '!'}</span><span>{step.label || displayTool(step.tool)}</span><small>{step.status}</small><Icon name="chevron" size={12} /></summary><div><p>Tool: {step.tool} · {when(step.completed_at)}</p><pre>{JSON.stringify({ input: step.input, output: step.output }, null, 2)}</pre></div></details>{:else}<p class="research-tool-empty">Tools will appear here as the run progresses.</p>{/each}</div>{#if latestRun.error}<p class="research-run-error">{latestRun.error}</p>{/if}</section>{/if}
    {#if latestAnalysis && !pendingFollowup}
      <section class="panel research-design"><div class="panel-heading"><div><span class="section-kicker">03 / THE INFORMATIVE FOLLOW-UP</span><h2>Separate sample group from measurement order.</h2><p>Keep the full specimen design. Distribute both groups across the order instead of measuring one group first.</p></div><span class={`pill ${detail.investigation.design ? 'green' : 'amber'}`}>{detail.investigation.design ? 'Design reviewed' : 'Scientist review required'}</span></div><div class="research-design-body"><div class="research-manifest"><div><strong>8</strong><span>test specimens</span></div><div><strong>2</strong><span>fixed controls</span></div><div><strong>1</strong><span>replicate / specimen</span></div><p>SOP quantities and preparation overage are preserved. A material shortage never reduces the scientific design.</p></div>
        {#if detail.investigation.design}<p class="research-reviewed">Reviewed {when(detail.investigation.design.reviewed_at)} by {detail.investigation.design.reviewed_by} · protocol {detail.investigation.design.protocol_version}</p><div class="research-assignment">{#each detail.investigation.design.assignments as row}<div class:control={row.is_control}><small>{row.measurement_order}</small><strong>{row.specimen_id}</strong><span>{row.is_control ? 'Control' : row.sample_group}</span></div>{/each}</div><p class="research-design-rationale">{detail.investigation.design.rationale}</p>
        {:else}<div class="research-assignment">{#each proposedAssignments as row}<div class:control={row.is_control}><small>{row.measurement_order}</small><strong>{row.specimen_id}</strong><span>{row.is_control ? 'Control' : row.sample_group}</span></div>{/each}</div><p class="research-design-rationale">Proposed measurement order · all eight specimens and both fixed controls retained.</p><label for="research-protocol">Previously reviewed protocol<select id="research-protocol" bind:value={selectedProtocolId}><option value="">Select an approved protocol</option>{#each protocols as protocol}<option value={protocol.id}>{protocol.title} · {protocol.version}</option>{/each}</select></label><button class="text-button" onclick={onReviewProtocol}>{protocols.length ? 'Review a different protocol' : 'Review your protocol first'} <Icon name="arrow" size={14} /></button><label for="design-rationale">Why this follow-up distinguishes the explanations<textarea id="design-rationale" bind:value={rationale} rows="3" maxlength="2000"></textarea></label><label class="checkbox-label"><input type="checkbox" bind:checked={designAcknowledged} /><span>I have reviewed the full eight-specimen, two-control counterbalanced design and its compatibility with the linked protocol. This is a synthetic illustration, not scientific validation.</span></label><button class="primary" disabled={!!busy || !selectedProtocolId || !designAcknowledged || !rationale.trim()} onclick={reviewDesign}>Save reviewed design <Icon name="shield" size={15} /></button>{/if}
      </div></section>
    {/if}
    {#if proposal}<section class="panel research-proposal"><div class="panel-heading"><div><span class="section-kicker">{proposal.status === 'direction_only' ? 'THE NEXT RESEARCH DIRECTION' : 'ONE REVIEWABLE NEXT STEP'}</span><h2>{proposal.title}</h2><p>{proposal.rationale}</p></div><span class={`pill ${proposal.status === 'blocked' ? 'amber' : 'neutral'}`}>{proposalEvidenceStale ? 'Historical proposal' : proposal.status.replaceAll('_', ' ')}</span></div><div class="research-proposal-body"><p><strong>What it distinguishes</strong>{proposal.distinguishes}</p>{#if proposal.material_plan}<div class={`research-readiness ${proposal.material_plan.status === 'SHORTAGE' ? 'blocked' : ''}`}><div><Icon name="box" size={21} /><div><strong>{proposalEvidenceStale ? 'Historical material plan — new evidence needs analysis' : proposal.readiness_stale ? 'Stock changed — readiness needs refreshing' : proposal.material_plan.status === 'RESOURCE-SUFFICIENT' ? 'Recorded materials cover the full design' : proposal.material_plan.status === 'SHORTAGE' ? 'Full design blocked by recorded stock' : 'Material review needed'}</strong><span>{proposal.material_plan.specimen_count} specimens + {proposal.material_plan.fixed_controls} controls · inventory unchanged</span></div></div><div class="table-scroll"><table><thead><tr><th>RESOURCE</th><th>REQUIRED</th><th>RECORDED</th><th>SHORTAGE</th></tr></thead><tbody>{#each proposal.material_plan.lines as line}<tr><td>{line.resource_name}</td><td>{num(line.required)} µL</td><td>{num(line.available)} µL</td><td>{num(line.shortage)} µL</td></tr>{/each}</tbody></table></div></div><div class="research-proposal-links">{#if proposal.experiment_id}<button class="text-button" onclick={() => onViewPlan?.(proposal.experiment_id!)}>Open exact preflight & actual-use history <Icon name="arrow" size={14} /></button>{/if}<span>Protocol {proposal.material_plan.protocol_version}</span></div><label class="checkbox-label"><input type="checkbox" bind:checked={proposalAcknowledged} disabled={proposalEvidenceStale} /><span>I have reviewed this proposed follow-up. Recheck current materials and save my review; this does not record a performed experiment or consume stock.</span></label><button class="primary" disabled={!!busy || !proposalAcknowledged || proposalEvidenceStale} onclick={reviewProposal}>{proposal.reviewed_at ? 'Refresh materials & review' : 'Review proposed experiment'} <Icon name="shield" size={15} /></button>{:else if proposal.status === 'direction_only'}<div class="research-direction"><Icon name="leaf" size={24} /><div><strong>{proposal.next_direction}</strong><p>Evidence-linked direction saved. An additional physical experiment still needs its own reviewed design and material plan.</p></div></div>{:else}<p class="research-pending-design">Review the linked protocol and complete design above, then investigate again to prepare the exact material plan.</p>{/if}</div></section>{/if}
    {#if previousRevision && latestRevision}<section class="research-changed panel"><span class="section-kicker">04 / WHAT CHANGED WITH NEW EVIDENCE</span><h2>The investigation remembers why.</h2><div><article><span>Previous next step</span><p>{previousRevision.next_direction}</p></article><Icon name="arrow" size={22} /><article><span>Current next step</span><p>{latestRevision.next_direction}</p></article></div><blockquote>{latestRevision.reason_for_change}</blockquote><details class="research-details"><summary>Full interpretation history</summary>{#each detail.revisions.toSorted((a, b) => a.revision - b.revision) as revision}<div class="research-revision"><strong>Revision {revision.revision} · {when(revision.created_at)}</strong><p>{revision.next_direction}</p><small>{revision.reason_for_change} · Evidence: {revision.evidence_ids.join(', ')}</small></div>{/each}</details></section>{/if}
    {#if proposal?.material_plan && !pendingFollowup}<section class="research-result-invite"><Icon name="leaf" size={27} /><div><span class="section-kicker">AFTER THE EXPERIMENT / ADD WHAT YOU OBSERVED</span><h2>Let new evidence change the next step.</h2><p>Import a result independently of actual-use recording. The synthetic follow-up represents later observations; the app has not performed a physical experiment.</p></div><button class="primary" disabled={!!busy} onclick={() => useCompanion('followup')}>Add synthetic follow-up <Icon name="plus" size={15} /></button></section>{/if}
    <details class="panel research-import" open={!detail.evidence.length}><summary><Icon name="plus" size={16} />{detail.evidence.length ? 'Import another observation CSV' : 'Or import your own observation CSV'}</summary><div><p>Required columns: run_id, specimen_id, sample_group, measurement_order, signal, is_control. Keep eight specimens, two controls and source identifiers. Imports never change recorded stock.</p><div class="research-import-fields"><label>Evidence phase<select bind:value={phase}><option value="initial">Original observations</option><option value="followup">Follow-up results</option></select></label><label>Source type<select bind:value={kind}><option value="synthetic_observation">Synthetic observation</option><option value="imported_measurement">Imported measurement</option><option value="simulation_output">Simulation output</option></select></label><label>CSV file<input type="file" accept=".csv,text/csv" onchange={event => uploadFile = event.currentTarget.files?.[0] ?? null} /></label><label>Existing experiment ID (optional)<input bind:value={linkedExperiment} placeholder="Leave empty if no historical run is linked" /></label></div><label>Source context<textarea bind:value={evidenceNote} rows="2" placeholder="Where did this evidence come from? What should its reader know?"></textarea></label><button class="secondary" disabled={!!busy || !uploadFile} onclick={importFile}>Save observations{phase === 'followup' ? ' & investigate' : ''} <Icon name="arrow" size={14} /></button></div></details>
  {/if}
</div>
