<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$lib/lab/Icon.svelte';
  import type { ActualLine, Confirmation, ConsumptionEvent, InventoryResource, ProtocolDraft, RunPlan, SessionInfo } from '$lib/preflight/types';
  import './lab.css';

  type Experiment = { id: string; name: string; status: string; created_at: string };
  type Continuity = { experiment: Experiment; protocol: ProtocolDraft; plans: RunPlan[]; confirmations: Confirmation[]; events: ConsumptionEvent[]; issues: string[] };
  let session = $state<SessionInfo | null>(null);
  let needsSignIn = $state(false);
  let workspaceToken = $state('');
  let inventory = $state<InventoryResource[]>([]);
  let experiments = $state<Experiment[]>([]);
  let draft = $state<ProtocolDraft | null>(null);
  let plan = $state<RunPlan | null>(null);
  let continuity = $state<Continuity | null>(null);
  let confirmation = $state<Confirmation | null>(null);
  let tab = $state('Preflight');
  let busy = $state('Connecting to your workspace');
  let error = $state('');
  let notice = $state('');
  let specimenCount = $state(8);
  let experimentName = $state('Microplate readout');
  let experimentId = $state('');
  let historyId = $state('');
  let acknowledged = $state(false);
  let approved = $state(false);
  let actualOpen = $state(false);
  let actuals = $state<ActualLine[]>([]);
  let actualAcknowledged = $state(false);
  let justification = $state('');
  let idempotencyKey = $state('');
  let search = $state('');
  let inventoryInput: HTMLInputElement;
  let importDraft = $state<{ id: string; name: string; balance: string; reorder_threshold: string; unit: string; lots: { id: string; balance: string; expires: string | null }[] }[] | null>(null);
  let importName = $state('');
  let importAcknowledged = $state(false);
  let fileInput: HTMLInputElement;
  const projectId = 'demo-lab';
  const navigation = [{ name: 'Preflight', icon: 'flask' }, { name: 'Inventory', icon: 'box' }, { name: 'Experiment history', icon: 'clock' }];
  const filteredInventory = $derived(inventory.filter(item => item.name.toLowerCase().includes(search.toLowerCase())));
  const stage = $derived(!draft ? 1 : !approved ? 2 : !plan ? 3 : 4);
  const amount = (value: string | number | null | undefined) => value === null || value === undefined ? '—' : new Intl.NumberFormat('en-GB', { maximumFractionDigits: 6 }).format(Number(value));
  const unit = (value: string | null | undefined) => value === 'uL' ? 'µL' : value ?? 'unit missing';
  const date = (value: string) => new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const label = (value: string) => value === 'RESOURCE-SUFFICIENT' ? 'Resources sufficient' : value === 'SHORTAGE' ? 'Material shortage' : 'Review required';

  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.method && init.method !== 'GET') headers.set('X-CSRF-Token', session?.csrf_token ?? '');
    const response = await fetch(`/api/lab${path}`, { ...init, headers });
    const data = await response.json();
    if (response.status === 401) { needsSignIn = true; session = null; }
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message ?? 'The request could not be completed.');
    return data as T;
  }
  const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  async function refresh() {
    const [stock, runs] = await Promise.all([api<{ resources: InventoryResource[] }>(`/inventory?project_id=${projectId}`), api<{ experiments: Experiment[] }>(`/experiments?project_id=${projectId}`)]);
    inventory = stock.resources;
    experiments = runs.experiments;
  }
  onMount(() => {
    void (async () => {
      try { session = await api<SessionInfo>('/session'); await refresh(); }
      catch (e) { error = (e as Error).message; }
      finally { busy = ''; }
    })();
  });
  async function signIn(event: SubmitEvent) {
    event.preventDefault();
    if (!workspaceToken.trim()) return;
    busy = 'Signing in to the workspace'; error = '';
    const accessToken = workspaceToken.trim();
    workspaceToken = '';
    try {
      const response = await fetch('/api/lab/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: accessToken }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message ?? 'Workspace sign-in failed.');
      session = data as SessionInfo; needsSignIn = false;
      await refresh();
      notice = 'Signed in to your research workspace.';
    } catch (e) { error = (e as Error).message; }
    finally { busy = ''; }
  }
  async function upload(file: File) {
    busy = 'Reading the protocol'; error = ''; notice = '';
    try {
      const form = new FormData(); form.set('file', file); form.set('project_id', projectId);
      draft = await api<ProtocolDraft>('/protocols/parse', { method: 'POST', body: form });
      approved = false; acknowledged = false; plan = null; confirmation = null; experimentId = ''; actualOpen = false;
      notice = 'Draft extracted. Review each quantity, mapping and assumption against its source.';
    } catch (e) { error = (e as Error).message; }
    finally { busy = ''; if (fileInput) fileInput.value = ''; }
  }
  async function useExample() {
    busy = 'Opening the engineering test SOP'; error = '';
    try {
      const response = await fetch('/fixtures/synthetic_microplate_sop.pdf');
      if (!response.ok) throw new Error('The example protocol could not be loaded.');
      await upload(new File([await response.blob()], 'synthetic_microplate_sop.pdf', { type: 'application/pdf' }));
    } catch (e) { error = (e as Error).message; busy = ''; }
  }
  function edited() { approved = false; acknowledged = false; plan = null; confirmation = null; }
  async function approve() {
    if (!draft || !acknowledged) return;
    busy = 'Saving your reviewed protocol'; error = '';
    try {
      draft = await api<ProtocolDraft>(`/protocols/${draft.id}/approve`, json({ rows: draft.rows, fixed_controls: draft.fixed_controls, replicates_per_specimen: draft.replicates_per_specimen, overage_percent: draft.overage_percent, acknowledged: true }));
      approved = true; plan = null; notice = 'Protocol reviewed and saved. Configure your specimen count to check readiness.';
    } catch (e) { error = (e as Error).message; }
    finally { busy = ''; }
  }
  async function preview() {
    if (!draft || !approved) return;
    busy = 'Checking run-specific requirements'; error = ''; confirmation = null; actualOpen = false;
    try {
      plan = await api<RunPlan>('/run-plans/preview', json({ project_id: projectId, protocol_id: draft.id, specimen_count: specimenCount, ...(experimentId ? { experiment_id: experimentId } : { experiment_name: experimentName }) }));
      experimentId = plan.experiment_id;
      await refresh();
      notice = 'Preflight saved. Recorded inventory is unchanged; no consumption was recorded.';
    } catch (e) { error = (e as Error).message; }
    finally { busy = ''; }
  }
  function changeCount(value?: number) { if (value !== undefined) specimenCount = value; plan = null; confirmation = null; actualOpen = false; }
  function newRun() {
    experimentId = ''; plan = null; confirmation = null; actualOpen = false;
    notice = 'New experiment ready to plan with your reviewed protocol and current recorded stock.';
  }
  function reviewActual() {
    if (!plan) return;
    actuals = plan.lines.map(line => ({ resource_id: line.resource_id, amount: line.required, unit: line.unit, lot_id: null }));
    actualAcknowledged = false; justification = ''; idempotencyKey = crypto.randomUUID(); actualOpen = true; error = '';
  }
  async function loadContinuity(id: string) {
    if (!id) return;
    busy = 'Loading experiment evidence'; error = '';
    try { continuity = await api<Continuity>(`/experiments/${id}/continuity`); historyId = id; }
    catch (e) { error = (e as Error).message; }
    finally { busy = ''; }
  }
  async function confirmActual() {
    if (!plan || !actualAcknowledged) return;
    busy = 'Recording confirmed actual use'; error = '';
    try {
      confirmation = await api<Confirmation>(`/experiments/${plan.experiment_id}/consumption/confirm`, json({ plan_id: plan.id, idempotency_key: idempotencyKey, confirmed: true, actuals, justification }));
      actualOpen = false; await refresh();
      await loadContinuity(plan.experiment_id);
      notice = 'Actual use recorded. Inventory and the experiment evidence trail have been updated.';
    } catch (e) { error = (e as Error).message; }
    finally { busy = ''; }
  }
  function manageDialog(node: HTMLDialogElement) {
    const previous = document.activeElement as HTMLElement | null;
    node.showModal();
    return { destroy() { node.close(); previous?.focus(); } };
  }
  async function readInventory(file: File) {
    error = ''; importAcknowledged = false;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Use an inventory JSON file smaller than 2 MB.');
      const content = JSON.parse(await file.text());
      const rows = Array.isArray(content) ? content : content.resources;
      if (!Array.isArray(rows) || !rows.length || rows.length > 100 || rows.some(row => !row || typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.balance !== 'string' || typeof row.reorder_threshold !== 'string' || !['uL', 'mL'].includes(row.unit) || !Array.isArray(row.lots))) throw new Error('Inventory JSON needs 1–100 resources with id, name, balance and reorder_threshold as strings, unit (uL or mL), and a lots array.');
      importDraft = rows; importName = file.name;
    } catch (e) { error = (e as Error).message; importDraft = null; }
    finally { if (inventoryInput) inventoryInput.value = ''; }
  }
  async function importInventory() {
    if (!importDraft || !importAcknowledged) return;
    busy = 'Importing reviewed inventory baseline'; error = '';
    try {
      const result = await api<{ resources: InventoryResource[] }>('/inventory/import', json({ project_id: projectId, confirmed: true, source_name: importName, resources: importDraft }));
      inventory = result.resources; importDraft = null; plan = null; confirmation = null;
      notice = `Imported ${result.resources.length} resources from ${importName}. Run a new preflight against this baseline.`;
    } catch (e) { error = (e as Error).message; }
    finally { busy = ''; }
  }
  function exportEvidence() {
    if (!continuity) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(continuity, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `labrelax-${historyId}.json`; link.click(); URL.revokeObjectURL(url);
  }
  function showHistory(id?: string) { tab = 'Experiment history'; const chosen = id || historyId || experiments[0]?.id; if (chosen) void loadContinuity(chosen); }
</script>

<svelte:head>
  <title>LabRelax — Know before you run.</title>
  <meta name="description" content="Source-linked protocol review, run-specific inventory checks, and a separately confirmed actual-use record. Built on OpenFoundry." />
</svelte:head>

<div class="lab-app">
  <aside class="sidebar">
    <a href="/lab" class="brand"><span class="brand-icon"><Icon name="flask" size={25} /></span>labrelax<span>.</span></a>
    <div class="workspace"><div class="workspace-avatar">LR</div><div><strong>Research workspace</strong><small>Protocol preflight</small></div><span>⌄</span></div>
    <div class="nav-label">YOUR LAB</div>
    <nav aria-label="Lab navigation">{#each navigation as item}<button class:active={tab === item.name} onclick={() => item.name === 'Experiment history' ? showHistory() : tab = item.name}><Icon name={item.icon} size={18} />{item.name}{#if item.name === 'Preflight'}<span class="nav-count">01</span>{/if}</button>{/each}</nav>
    <div class="sidebar-bottom">
      <div class="sidebar-note"><Icon name="shield" size={20} /><strong>A scientist stays in control.</strong><p>Review the source. Check the plan. Confirm actual use separately.</p></div>
      <div class="profile"><span class="profile-avatar">{session?.user.name.split(' ').map(v => v[0]).slice(0, 2).join('') ?? '…'}</span><div><strong>{session?.user.name ?? 'Connecting…'}</strong><small>{session?.user.role ?? 'Authenticated workspace'}</small></div><span class="online-dot"></span></div>
      <a class="powered" href="https://github.com/u485349-coder/OpenFoundry" target="_blank" rel="noreferrer">Built on OpenFoundry <span>↗</span></a>
    </div>
  </aside>
  <div class="main-shell">
    <header class="topbar"><div class="breadcrumb">Workspace <span>/</span><strong>{tab}</strong></div><div class="top-actions"><span class="demo-tag">SYNTHETIC DEMONSTRATOR</span><span class="secure-label"><Icon name="shield" size={14} />Researcher review</span></div></header>
    <main>
      <div class="page-heading"><div><div class="eyebrow">LABRELAX / EXPERIMENT READINESS</div><h1>{tab === 'Preflight' ? 'Know before you run.' : tab === 'Inventory' ? 'Every resource, accounted for.' : 'The story behind the experiment.'}</h1><p>{tab === 'Preflight' ? 'From protocol to a clear, source-linked materials decision.' : tab === 'Inventory' ? 'Recorded balances, thresholds and lots. Live from your workspace.' : 'Reviewed assumptions, planned quantities and confirmed actual use.'}</p></div><span class="heading-icon"><Icon name={tab === 'Inventory' ? 'box' : tab === 'Experiment history' ? 'clock' : 'flask'} size={34} /></span></div>
      <div class="demo-notice"><span><span class="notice-dot"></span>Synthetic protocol & inventory · Hackathon demonstrator</span><span>Readiness checks recorded materials, not scientific validity.</span></div>
      {#if error}<div class="alert error" role="alert"><Icon name="shield" size={18} /><div><strong>Action needs attention</strong><p>{error}</p></div><button aria-label="Dismiss error" onclick={() => error = ''}><Icon name="close" size={16} /></button></div>{/if}
      {#if notice}<div class="notice" role="status"><Icon name="check" size={15} /><span>{notice}</span><button aria-label="Dismiss notification" onclick={() => notice = ''}><Icon name="close" size={14} /></button></div>{/if}
      {#if busy}<div class="loading" role="status"><span class="spinner"></span>{busy}…</div>{/if}

      {#if needsSignIn}
        <section class="panel signin-panel"><span class="signin-icon"><Icon name="shield" size={26} /></span><span class="section-kicker">YOUR RESEARCH WORKSPACE</span><h2>Sign in to LabRelax.</h2><p>Enter the workspace access token supplied by your team administrator to open protocols, recorded inventory and experiment evidence.</p><form onsubmit={signIn}><label for="workspace-token">Workspace access token</label><input id="workspace-token" type="password" autocomplete="off" spellcheck="false" bind:value={workspaceToken} placeholder="Enter your access token" required disabled={!!busy} /><button class="primary" type="submit" disabled={!!busy || !workspaceToken.trim()}>Sign in <Icon name="arrow" size={15} /></button></form><small>Your token is exchanged for an authenticated session.</small></section>
      {:else if tab === 'Preflight'}
        <div class="steps" aria-label="Workflow progress">{#each ['Upload protocol', 'Review evidence', 'Check readiness', 'Record actual use'] as step, i}<div class:current={stage === i + 1} class:complete={stage > i + 1}><span>{#if stage > i + 1}<Icon name="check" size={13} />{:else}{i + 1}{/if}</span><strong>{step}</strong></div>{/each}</div>
        {#if !draft}
          <div class="welcome-grid">
            <section class="panel upload-panel"><span class="section-kicker">START WITH THE SOURCE</span><h2>Your protocol.<br />A clearer plan.</h2><p>Upload the supported microplate SOP. Review the extracted reagent table before any quantities are calculated.</p><div class="upload-box"><span class="upload-icon"><Icon name="download" size={25} /></span><strong>Choose a protocol PDF</strong><span>Supported, machine-readable microplate layout · up to 2 MB</span><button class="primary" disabled={!!busy || !session} onclick={() => fileInput.click()}><Icon name="plus" size={16} />Upload protocol</button></div><div class="example-row"><span>Temporary test fixture</span><button class="text-button" disabled={!!busy || !session} onclick={useExample}>Load engineering test SOP <Icon name="arrow" size={14} /></button></div></section>
            <aside class="intro-card"><span class="large-mark"><Icon name="leaf" size={31} /></span><span class="section-kicker">A SMALL CHECK. AN IMPORTANT DIFFERENCE.</span><h2>“In stock” doesn’t always mean enough.</h2><p>A routine stock threshold can look healthy while a specific run needs more. Include your specimens, controls and reviewed preparation overage to see the whole requirement.</p><div class="promise"><Icon name="link" size={18} /><div><strong>Evidence you can inspect</strong><span>Each extracted value keeps its source.</span></div></div><div class="promise"><Icon name="shield" size={18} /><div><strong>Planning never consumes stock</strong><span>Actual use has its own confirmation.</span></div></div><a href="/fixtures/synthetic_microplate_sop.pdf" target="_blank" rel="noreferrer" class="text-button">View engineering test source <Icon name="arrow" size={14} /></a></aside>
          </div>
        {:else}
          <section class="panel protocol-panel"><div class="panel-heading"><div><span class="section-kicker">01 / SOURCE & ASSUMPTIONS</span><h2>{draft.title}</h2><p>{draft.filename} <span>·</span> {draft.version} <span>·</span> {draft.extraction_method === 'openai' ? 'AI-assisted extraction · human review required' : 'Supported-template extraction · human review required'}</p></div><button class="secondary compact" disabled={!!busy} onclick={() => fileInput.click()}><Icon name="reset" size={14} />Replace PDF</button></div>
            <div class="protocol-layout"><div class="source-pane"><div class="source-heading"><span><Icon name="link" size={14} />Original source</span><a href={`/api/lab/protocols/${draft.id}/source`} target="_blank" rel="noreferrer">Open PDF ↗</a></div><iframe title="Uploaded protocol source PDF" src={`/api/lab/protocols/${draft.id}/source#toolbar=0`}><p>Open the PDF to inspect your source.</p></iframe><details><summary>Extracted source text</summary><pre>{draft.source_text}</pre></details></div><div class="review-pane"><div class="review-heading"><h3>Review the reagent table</h3><span class={`pill ${approved ? 'green' : 'amber'}`}>{approved ? 'Reviewed' : 'Review required'}</span></div><p class="muted">Verify the amount, unit and inventory mapping. Edits preserve the original source evidence.</p>
              {#if draft.issues.length}<div class="inline-warning">{#each draft.issues as issue}<p>{issue}</p>{/each}</div>{/if}
              <div class="reagent-review">{#each draft.rows as row, i}<div class="reagent-row"><div class="row-number">{String(i + 1).padStart(2, '0')}</div><div class="row-fields"><label>Inventory resource<select bind:value={row.resource_id} onchange={edited} disabled={approved || !!busy}><option value={null}>Select a resource</option>{#each inventory as resource}<option value={resource.id}>{resource.name}</option>{/each}</select></label><div class="quantity-fields"><label>Per reaction<input type="text" inputmode="decimal" bind:value={row.per_reaction} oninput={edited} disabled={approved || !!busy} aria-label={`${row.resource_name} per reaction`} /></label><label>Unit<select bind:value={row.unit} onchange={edited} disabled={approved || !!busy}><option value={null}>Missing</option><option value="uL">µL</option><option value="mL">mL</option><option value="L">L</option><option value="mg">mg</option></select></label></div><details class="evidence"><summary>Source · page {row.source_page}, row {row.source_row}</summary><blockquote>{row.source_excerpt}</blockquote>{#if row.issues.length}<p class="warning-text">{row.issues.join(' · ')}</p>{/if}</details></div></div>{/each}</div>
              <div class="assumptions"><label>Replicates / specimen<input type="number" min="1" step="1" bind:value={draft.replicates_per_specimen} oninput={edited} disabled={approved || !!busy} /></label><label>Fixed controls<input type="number" min="0" step="1" bind:value={draft.fixed_controls} oninput={edited} disabled={approved || !!busy} /></label><label>Preparation overage (%)<input type="text" inputmode="decimal" bind:value={draft.overage_percent} oninput={edited} disabled={approved || !!busy} /></label></div>
              <label class="checkbox-label"><input type="checkbox" bind:checked={acknowledged} disabled={approved} /><span>I have checked the source, reagent mappings and preparation assumptions.</span></label><button class="primary full-width" onclick={approve} disabled={!!busy || !acknowledged || approved || !draft.supported_layout}><Icon name={approved ? 'check' : 'shield'} size={16} />{approved ? 'Reviewed protocol saved' : 'Approve reviewed protocol'}</button>{#if approved}<p class="locked-source">Approved versions are retained. Upload a new draft to change the source assumptions.</p>{/if}
            </div></div>
          </section>
          <section class="panel configure-panel"><div><span class="section-kicker">02 / YOUR PROPOSED RUN</span><h2>How many test specimens?</h2><p>Specimens exclude controls. Planning leaves recorded stock unchanged.</p></div><div class="run-form"><label>Experiment name<input type="text" bind:value={experimentName} disabled={!!experimentId} maxlength="160" /></label><label class="specimen-label">Test specimens<input type="number" min="1" max="100000" step="1" bind:value={specimenCount} disabled={!!busy} oninput={() => changeCount()} /></label><button class="primary" disabled={!!busy || !approved} onclick={preview}><Icon name="bolt" size={16} />Check readiness</button></div>{#if !approved}<p class="lock-note"><Icon name="shield" size={13} />Review and approve the protocol to enable a readiness check.</p>{/if}<div class="what-if"><span>User-directed comparison</span><button class:chosen={specimenCount === 8} disabled={!!busy} onclick={() => changeCount(8)}>8 specimens</button><button class:chosen={specimenCount === 6} disabled={!!busy} onclick={() => changeCount(6)}>6 specimens</button><small>A numerical what-if, not a recommendation to change experimental design.</small></div></section>
          {#if plan}
            <section class={`panel result-panel ${plan.status === 'SHORTAGE' ? 'shortage' : plan.status === 'RESOURCE-SUFFICIENT' ? 'sufficient' : 'needs-review'}`}><div class="result-heading"><span class="result-icon"><Icon name={plan.status === 'RESOURCE-SUFFICIENT' ? 'check' : 'shield'} size={23} /></span><div><span class="section-kicker">03 / PREFLIGHT RESULT</span><h2>{label(plan.status)}</h2><p>{plan.specimen_count} specimens × {plan.replicates_per_specimen} replicate{plan.replicates_per_specimen === 1 ? '' : 's'} + {plan.fixed_controls} controls = {plan.reactions} reactions · {amount(plan.overage_percent)}% preparation overage</p></div><span class="pill neutral"><Icon name="shield" size={12} />{confirmation ? 'Actual use recorded' : 'Stock unchanged'}</span></div>
              {#if plan.issues.length}<div class="result-issues">{#each plan.issues as issue}<p>{issue}</p>{/each}</div>{/if}
              <div class="table-scroll"><table><thead><tr><th>RESOURCE</th><th>RECORDED STOCK</th><th>REQUIRED</th><th>FORECAST BALANCE</th><th>RUN READINESS</th></tr></thead><tbody>{#each plan.lines as line}<tr class:shortage-row={line.status === 'SHORTAGE'}><td><strong>{line.resource_name}</strong><small>Source page {line.source_page} · {amount(line.per_reaction)} µL / reaction</small></td><td>{amount(line.available)} <span class="muted">µL</span><small>Threshold {amount(line.reorder_threshold)} µL · {line.conventional_low_stock ? 'Low stock' : 'Above threshold'}</small></td><td class="required-number">{amount(line.required)} <span>µL</span></td><td class:negative={Number(line.forecast_balance) < 0}>{amount(line.forecast_balance)} µL</td><td><span class={`pill ${line.status === 'SHORTAGE' ? 'red' : line.status === 'RESOURCE-SUFFICIENT' ? 'green' : 'amber'}`}>{line.status === 'SHORTAGE' ? `${amount(line.shortage)} µL short` : label(line.status)}</span></td></tr>{/each}</tbody></table></div>
              <div class="result-footer"><p><Icon name="link" size={15} />Based on reviewed protocol {plan.protocol_version} and the stock snapshot at {date(plan.created_at)}.</p><button class="secondary compact" onclick={() => showHistory(plan?.experiment_id)}>View evidence trail <Icon name="arrow" size={14} /></button></div>
            </section>
            <section class="execution-card"><div class="execution-icon"><Icon name="shield" size={24} /></div><div><span class="section-kicker">04 / AFTER THE RUN</span><h2>Record what you actually used.</h2><p>{confirmation ? 'Confirmed actual consumption is now part of the experiment record.' : plan.status === 'SHORTAGE' ? 'Resolve the shortage or review a scientifically approved alternative before recording this run.' : 'Prepared quantity is a plan. Only your separate actual-use confirmation changes stock.'}</p></div>{#if confirmation}<button class="primary" onclick={() => showHistory(confirmation?.experiment_id)}>View confirmed record <Icon name="arrow" size={15} /></button><button class="secondary" disabled={!!busy} onclick={newRun}>Start another run</button>{:else}<button class="primary" disabled={!!busy || plan.status !== 'RESOURCE-SUFFICIENT'} onclick={reviewActual}>Review actual use <Icon name="arrow" size={15} /></button>{/if}</section>
          {/if}
        {/if}
      {:else if tab === 'Inventory'}
        <section class="panel inventory-import"><div><span class="section-kicker">TEAM DATA / INITIAL BASELINE</span><h2>Bring your own inventory.</h2><p>Import a reviewed JSON baseline before recording any actual use. The file replaces this project's stock register; historical consumption prevents replacement.</p></div><button class="secondary" disabled={!!busy || !session} onclick={() => inventoryInput.click()}><Icon name="plus" size={15} />Choose inventory JSON</button>
          {#if importDraft}<div class="import-preview"><div class="import-preview-heading"><strong>{importName}</strong><span>{importDraft.length} resources</span></div><div class="table-scroll"><table><thead><tr><th>RESOURCE</th><th>NEW BALANCE</th><th>THRESHOLD</th><th>RECORDED LOTS</th></tr></thead><tbody>{#each importDraft as resource}<tr><td><strong>{resource.name}</strong><small>{resource.id}</small></td><td>{amount(resource.balance)} {unit(resource.unit)}</td><td>{amount(resource.reorder_threshold)} {unit(resource.unit)}</td><td>{resource.lots.length}</td></tr>{/each}</tbody></table></div><label class="checkbox-label"><input type="checkbox" bind:checked={importAcknowledged} /><span>I have reviewed this synthetic or permission-cleared data and authorise replacing the project's initial inventory baseline.</span></label><div class="import-actions"><button class="secondary compact" onclick={() => importDraft = null} disabled={!!busy}>Cancel import</button><button class="primary" disabled={!!busy || !importAcknowledged} onclick={importInventory}>Import reviewed baseline <Icon name="check" size={15} /></button></div></div>{/if}
          <details class="import-format"><summary>Expected JSON format</summary><pre>{JSON.stringify({ resources: [{ id: 'buffer-a', name: 'Buffer A', balance: '700', reorder_threshold: '100', unit: 'uL', lots: [{ id: 'LOT-A', balance: '700', expires: null }] }] }, null, 2)}</pre></details>
        </section>
        <div class="section-toolbar"><div class="search-box"><Icon name="search" size={17} /><input placeholder="Find a resource…" aria-label="Search inventory" bind:value={search} /></div><span class="muted">{inventory.length} resources · server-recorded balances</span><button class="secondary compact" disabled={!!busy} onclick={async () => { busy = 'Refreshing inventory'; try { await refresh(); } catch(e) { error = (e as Error).message; } finally { busy = ''; } }}><Icon name="reset" size={14} />Refresh</button></div>
        <section class="panel"><div class="panel-heading"><div><h2>Stock register</h2><p>Thresholds indicate general stock levels. A preflight checks the specific proposed run.</p></div><span class="pill green">Recorded inventory</span></div><div class="table-scroll"><table><thead><tr><th>RESOURCE</th><th>RECORDED BALANCE</th><th>REORDER THRESHOLD</th><th>CONVENTIONAL ALERT</th><th>REVISION</th></tr></thead><tbody>{#each filteredInventory as resource}<tr><td><strong>{resource.name}</strong><small>{resource.id}</small></td><td class="required-number">{amount(resource.balance)} <span>µL</span></td><td>{amount(resource.reorder_threshold)} µL</td><td><span class={`pill ${Number(resource.balance) <= Number(resource.reorder_threshold) ? 'amber' : 'green'}`}>{Number(resource.balance) <= Number(resource.reorder_threshold) ? 'At / below threshold' : 'Above threshold'}</span></td><td>r{resource.revision}</td></tr>{:else}<tr><td colspan="5" class="empty">{busy ? 'Loading resources…' : 'No matching resources.'}</td></tr>{/each}</tbody></table></div></section>
        <div class="subheading"><h2>Lot register</h2><p>Lot information is recorded evidence; missing lot details remain unresolved.</p></div><div class="lot-grid">{#each filteredInventory as resource}{#each resource.lots as lot}<article class="lot-card"><div><span class="section-kicker">{resource.name}</span><Icon name="box" size={19} /></div><h3>{lot.id}</h3><strong>{amount(lot.balance)} <span>µL</span></strong><p>{lot.expires ? `Recorded expiry: ${lot.expires}` : 'Expiry not recorded'}</p></article>{/each}{/each}</div>
      {:else}
        <div class="section-toolbar"><label class="history-picker">Experiment<select value={historyId} onchange={(event) => loadContinuity(event.currentTarget.value)}><option value="">Select an experiment</option>{#each experiments as experiment}<option value={experiment.id}>{experiment.name}</option>{/each}</select></label>{#if continuity}<button class="secondary compact" onclick={exportEvidence}><Icon name="download" size={15} />Export evidence</button>{/if}</div>
        {#if continuity}
          <section class="panel"><div class="panel-heading"><div><span class="section-kicker">EXPERIMENT CONTINUITY</span><h2>{continuity.experiment.name}</h2><p>{continuity.experiment.id} · {continuity.experiment.status}</p></div><span class="pill neutral">{continuity.events.length} consumption events</span></div><div class="history-facts"><div><span>Protocol</span><strong>{continuity.protocol.title}</strong><small>{continuity.protocol.version} · approval r{continuity.protocol.approval_revision ?? '—'}</small></div><div><span>Reviewed by</span><strong>{continuity.protocol.reviewed_by ?? 'Not reviewed'}</strong><small>{continuity.protocol.reviewed_at ? date(continuity.protocol.reviewed_at) : 'Approval required'}</small></div><div><span>Original evidence</span><a href={`/api/lab/protocols/${continuity.protocol.id}/source`} target="_blank" rel="noreferrer">Open source PDF ↗</a><small>SHA-256 {continuity.protocol.file_hash.slice(0, 14)}…</small></div></div>{#if continuity.issues.length}<div class="history-issues"><Icon name="shield" size={18} /><div><strong>Unresolved information</strong>{#each continuity.issues as issue}<p>{issue}</p>{/each}</div></div>{/if}</section>
          <div class="subheading"><h2>Planned versus actual</h2><p>Actual use comes only from an explicit researcher confirmation.</p></div><section class="panel"><div class="table-scroll"><table><thead><tr><th>RESOURCE / LOT</th><th>PLANNED</th><th>ACTUAL</th><th>VARIANCE</th><th>RECORDED BY</th></tr></thead><tbody>{#each continuity.events as event}<tr><td><strong>{event.resource_name}</strong><small>{event.lot_id ?? 'Lot unknown · unresolved'}</small></td><td>{amount(event.planned)} µL</td><td class="required-number">{amount(event.actual)} <span>µL</span></td><td>{Number(event.variance) > 0 ? '+' : ''}{amount(event.variance)} µL</td><td><strong>{event.actor_id}</strong><small>{date(event.timestamp)}</small>{#if event.justification}<small>{event.justification}</small>{/if}</td></tr>{:else}<tr><td colspan="5" class="empty"><Icon name="shield" size={22} /><strong>No actual use confirmed.</strong><span>Previews have not consumed any inventory.</span></td></tr>{/each}</tbody></table></div></section>
          <div class="subheading"><h2>Preflight trail</h2><p>Historical checks retain their own assumptions and stock snapshots.</p></div><div class="plan-history">{#each continuity.plans as historyPlan}<article class="panel history-plan"><span class="timeline-icon"><Icon name="flask" size={19} /></span><div><strong>{historyPlan.specimen_count} specimens · {historyPlan.reactions} reactions</strong><p>{historyPlan.fixed_controls} controls · {amount(historyPlan.overage_percent)}% overage · {date(historyPlan.created_at)}</p><small>{historyPlan.id} · by {historyPlan.created_by}</small></div><span class={`pill ${historyPlan.status === 'SHORTAGE' ? 'red' : historyPlan.status === 'RESOURCE-SUFFICIENT' ? 'green' : 'amber'}`}>{label(historyPlan.status)}</span></article>{/each}</div>
        {:else}<section class="panel empty-history"><Icon name="clock" size={35} /><h2>Every experiment has a story.</h2><p>{experiments.length ? 'Choose an experiment to inspect its reviewed source and usage evidence.' : 'Run your first preflight to start a source-linked experiment record.'}</p><button class="primary" onclick={() => tab = 'Preflight'}>Start a preflight <Icon name="arrow" size={15} /></button></section>{/if}
      {/if}
      <footer class="page-footer"><span>Thoughtful preparation. Accountable science.</span><span>LabRelax × OpenFoundry · Synthetic evidence</span></footer>
    </main>
  </div>
</div>
<input class="sr-only" type="file" accept="application/json,.json" bind:this={inventoryInput} aria-label="Upload inventory JSON" onchange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void readInventory(file); }} />
<input class="sr-only" type="file" accept="application/pdf,.pdf" bind:this={fileInput} aria-label="Upload protocol PDF" onchange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void upload(file); }} />
{#if actualOpen && plan}
  <dialog class="actual-dialog" use:manageDialog aria-labelledby="actual-title" oncancel={() => actualOpen = false}><section class="modal"><button class="close-button" aria-label="Close actual-use review" disabled={!!busy} onclick={() => actualOpen = false}><Icon name="close" size={20} /></button><span class="section-kicker">SEPARATE RESEARCHER CONFIRMATION</span><h2 id="actual-title">What did you actually use?</h2><p>Starting values are the planned preparation quantities. Replace them with actual use after the run. Confirming updates recorded stock.</p>{#each actuals as actual}<div class="actual-row"><strong>{inventory.find(item => item.id === actual.resource_id)?.name ?? actual.resource_id}</strong><div><label>Actual amount (µL)<input type="text" inputmode="decimal" bind:value={actual.amount} /></label><label>Recorded lot<select bind:value={actual.lot_id}><option value={null}>Unknown / not recorded</option>{#each inventory.find(item => item.id === actual.resource_id)?.lots ?? [] as lot}<option value={lot.id}>{lot.id} · {amount(lot.balance)} µL</option>{/each}</select></label></div></div>{/each}<div class="inline-warning">A missing lot remains an explicit issue in the experiment record. It will never be invented.</div><label class="justification">Run notes / reason for any variance<textarea bind:value={justification} rows="2" placeholder="Explain any difference from the planned quantities."></textarea></label><label class="checkbox-label"><input type="checkbox" bind:checked={actualAcknowledged} /><span>I confirm these are the actual quantities used, and authorise recording consumption.</span></label>{#if error}<div class="inline-warning" role="alert">{error}</div>{/if}<div class="modal-actions"><button class="secondary" disabled={!!busy} onclick={() => actualOpen = false}>Keep as a plan</button><button class="primary" disabled={!!busy || !actualAcknowledged} onclick={confirmActual}>{busy ? 'Recording…' : 'Confirm actual use'}<Icon name="check" size={15} /></button></div></section></dialog>
{/if}
