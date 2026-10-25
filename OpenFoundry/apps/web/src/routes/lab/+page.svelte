<script lang="ts">
  import Icon from '$lib/lab/Icon.svelte';
  import { seed, evaluate, propose, money, remaining, spent, committed, transition, addExperiment, finishExperiment, datePlus, type Lab, type Role, type Experiment, type Order } from '$lib/lab/model';
  import './lab.css';

  let lab = $state<Lab>(seed());
  let tab = $state('Overview');
  let role = $state<Role>('manager');
  let modal = $state<'experiment' | 'assistant' | 'order' | 'reset' | null>(null);
  let selected = $state('');
  let toast = $state('');
  let error = $state('');
  let ready = $state(false);
  let storageStatus = $state('Loading saved state…');
  let search = $state('');
  let filter = $state('Active');
  let assistantText = $state('');
  let assistantBusy = $state(false);
  let assistantNote = $state('');
  let form = $state({ name: '', date: '2026-10-30', supply: 'tips', quantity: 100, notes: '', data: '' });
  let draftNeeds = $state<Experiment['needs'] | null>(null);
  let lastLatency = $state<number | null>(null);
  const key = 'labfoundry-demo-v1';
  const tabs = [{ name: 'Overview', icon: 'grid' }, { name: 'Experiments', icon: 'flask' }, { name: 'Inventory', icon: 'box' }, { name: 'Purchases', icon: 'card' }];
  const decisions = $derived(evaluate(lab));
  const pending = $derived(lab.orders.filter(o => o.status === 'pending'));
  const activeOrders = $derived(lab.orders.filter(o => !['rejected', 'failed', 'received'].includes(o.status)));
  const order = $derived(lab.orders.find(o => o.id === selected));
  const atRisk = $derived(lab.batches.filter(b => b.expires >= lab.today && b.expires <= datePlus(lab.today, 7) && b.quantity > 0));
  const riskValue = $derived(atRisk.reduce((sum, b) => { const s = lab.supplies.find(s => s.id === b.supply)!; return sum + b.quantity / s.pack * s.price; }, 0));
  const upcoming = $derived(lab.experiments.filter(e => e.status === 'planned').sort((a, b) => a.date.localeCompare(b.date)));
  const dateLabel = (date: string) => new Date(date + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const statusLabel: Record<string, string> = { pending: 'Needs approval', approved: 'Approved', paid: 'Awaiting delivery', received: 'Received', rejected: 'Declined', failed: 'Payment failed' };
  const supplyName = (id: string) => lab.supplies.find(s => s.id === id)?.name ?? id;
  function restore() {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.version !== 1 || !Array.isArray(saved.orders) || !Array.isArray(saved.experiments) || !Array.isArray(saved.batches) || !Array.isArray(saved.supplies)) throw new Error();
        evaluate(saved); lab = saved;
      }
    } catch { toast = 'Saved demo could not be loaded. Fresh seed restored.'; }
    ready = true;
  }
  // ponytail: one browser owns this demo. Move state and transitions to PostgreSQL before shared use.
  $effect(() => {
    if (!ready) { restore(); return; }
    if (ready) {
      try { localStorage.setItem(key, JSON.stringify(lab)); storageStatus = 'Saved in this browser'; }
      catch { storageStatus = 'Session only · storage unavailable'; toast = 'Browser storage unavailable. Changes last for this session only.'; }
    }
  });
  function runCheck() {
    const start = performance.now(); lab = propose($state.snapshot(lab)); lastLatency = Math.max(1, Math.round(performance.now() - start));
    toast = `Stock check complete · ${pending.length} proposal${pending.length === 1 ? '' : 's'} awaiting approval · no model calls.`;
  }
  function change(action: Parameters<typeof transition>[2]) {
    try { lab = transition($state.snapshot(lab), selected, action, role); error = ''; toast = action === 'pay' ? 'Simulated payment recorded. No real funds moved.' : action === 'receive' ? 'Receipt recorded. Stock updated once.' : `Order ${action === 'approve' ? 'approved. Budget reserved.' : action === 'fail' ? 'failed. Budget reservation released.' : 'declined.'}`; }
    catch (e) { error = (e as Error).message; }
  }
  function openOrder(id: string) { selected = id; error = ''; modal = 'order'; }
  function newExperiment() { form = { name: '', date: '2026-10-30', supply: 'tips', quantity: 100, notes: '', data: '' }; draftNeeds = null; error = ''; modal = 'experiment'; }
  function saveExperiment(event: SubmitEvent) {
    event.preventDefault();
    try {
      lab = addExperiment($state.snapshot(lab), { name: form.name, date: form.date, owner: role === 'manager' ? 'Dr. Eleanor Reed' : 'Amelia Chen', notes: form.notes, data: form.data, needs: draftNeeds ?? [{ supply: form.supply, quantity: Number(form.quantity) }] });
      modal = null; tab = 'Experiments'; toast = 'Experiment scheduled. Resource demand and proposals updated.';
    } catch (e) { error = (e as Error).message; }
  }
  function complete(id: string, cancel = false) {
    try { lab = finishExperiment($state.snapshot(lab), id, cancel); toast = cancel ? 'Experiment cancelled. Demand updated.' : 'Experiment completed. Planned quantities recorded as actual use.'; }
    catch (e) { toast = (e as Error).message; }
  }
  async function askAssistant() {
    error = ''; assistantBusy = true;
    try {
      const res = await fetch('/api/lab/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: assistantText, today: lab.today }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      form = { name: data.draft.name, date: data.draft.date, notes: data.draft.notes, data: '', supply: data.draft.needs[0].supply, quantity: data.draft.needs[0].quantity };
      draftNeeds = data.draft.needs; assistantNote = `AI draft · ${data.usage ?? 'unknown'} tokens · ${data.latency_ms} ms. Review before saving.`; modal = 'experiment';
    } catch (e) { error = (e as Error).message; }
    finally { assistantBusy = false; }
  }
  function exportLog() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(lab, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'labfoundry-demo-audit.json'; a.click(); URL.revokeObjectURL(url);
  }
  function focusDialog(node: HTMLElement) {
    const previous = document.activeElement as HTMLElement | null;
    node.focus();
    function trap(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;
      const items = Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, a[href]'));
      const first = items[0], last = items.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    node.addEventListener('keydown', trap);
    return { destroy() { node.removeEventListener('keydown', trap); previous?.focus(); } };
  }
</script>

<svelte:head><title>LabFoundry — Lab operations, in order.</title><meta name="description" content="A supervised lab procurement demo built on OpenFoundry. Plan experiments, reduce waste, and approve restocking." /></svelte:head>

<div class="lab-app" inert={!!modal}>
  <aside class="sidebar">
    <a class="brand" href="/lab"><span class="brand-icon"><Icon name="flask" size={25} /></span>labfoundry<span class="brand-dot">.</span></a>
    <div class="workspace"><span class="workspace-avatar">B</span><div><strong>Blackwood Research</strong><small>Molecular biology lab</small></div><span class="workspace-chevron">⌄</span></div>
    <div class="nav-label">WORKSPACE</div>
    <nav aria-label="Lab navigation">{#each tabs as item}<button class:active={tab === item.name} onclick={() => { tab = item.name; search = ''; }}><Icon name={item.icon} size={18} />{item.name}{#if item.name === 'Purchases' && pending.length}<span class="nav-count">{pending.length}</span>{/if}</button>{/each}</nav>
    <div class="sidebar-bottom">
      <div class="supervision"><span class="green-dot"></span>Human supervision on<small>Every purchase. Your decision.</small></div>
      <button class="assistant-nav" onclick={() => { modal = 'assistant'; error = ''; }}><Icon name="spark" size={18} />Lab assistant<Icon name="arrow" size={17} /></button>
      <div class="sidebar-footer"><span class="user-avatar">ER</span><div><strong>Dr. Eleanor Reed</strong><small>Principal investigator</small></div></div>
      <a class="powered" href="https://github.com/u485349-coder/OpenFoundry" target="_blank" rel="noreferrer">Built on OpenFoundry <span>↗</span></a>
    </div>
  </aside>
  <div class="main-shell">
    <header class="topbar"><div class="breadcrumb">Workspace <span>/</span><strong>{tab}</strong></div><div class="top-actions"><span class="demo-tag">INTERACTIVE DEMO</span><label class="role-picker"><span class="sr-only">Demo role</span><select bind:value={role}><option value="manager">Lab manager</option><option value="researcher">Researcher</option></select></label><button class="icon-button" title="Reset demo" aria-label="Reset demo" onclick={() => modal = 'reset'}><Icon name="reset" size={17} /></button></div></header>
    <main>
      <div class="page-heading"><div><div class="eyebrow">BLACKWOOD RESEARCH / LAB OPERATIONS</div><h1>{tab === 'Overview' ? 'Good science. Less friction.' : tab}</h1><p>{tab === 'Overview' ? 'Keep experiments moving. Let nothing go to waste.' : tab === 'Experiments' ? 'Connect your research plans to the resources they need.' : tab === 'Inventory' ? 'Know what you have. Use what expires first.' : 'From identified need to approved spend. You stay in control.'}</p></div><button class="primary" onclick={newExperiment}><Icon name="plus" size={17} />New experiment</button></div>
      <div class="demo-notice"><span><Icon name="flask" size={15} />Demo workspace · 25 Oct 2026 · fictional data</span><span>Payments simulated. {storageStatus}.</span></div>

      {#if tab === 'Overview'}
        <section class="stats" aria-label="Lab summary">
          <article class="stat"><div class="stat-label">Available budget<Icon name="card" size={18} /></div><div class="stat-value">{money(remaining(lab)).replace('.00', '')}<span class="stat-unit">GBP</span></div><div class="budget-track"><span style={`width:${Math.min(100, spent(lab) / lab.budget * 100)}%`}></span><i style={`width:${Math.min(100, committed(lab) / lab.budget * 100)}%`}></i></div><div class="stat-foot">{money(spent(lab)).replace('.00', '')} spent <span>of {money(lab.budget).replace('.00', '')}</span></div></article>
          <article class="stat"><div class="stat-label">Purchases to review<Icon name="shield" size={18} /></div><div class="stat-value">{pending.length.toString().padStart(2, '0')}<span class="soft-pill orange">Approval needed</span></div><div class="stat-description">{money(pending.reduce((n, o) => n + o.total, 0))} proposed spend</div><button class="text-button" onclick={() => tab = 'Purchases'}>Review purchase queue <Icon name="arrow" size={15} /></button></article>
          <article class="stat green-stat"><div class="stat-label">Use before it expires<Icon name="leaf" size={18} /></div><div class="stat-value">{money(riskValue).replace('.00', '')}<span class="stat-unit">at risk</span></div><div class="stat-description">{atRisk.length} batch{atRisk.length === 1 ? '' : 'es'} expires in the next 7 days</div><button class="text-button" onclick={() => tab = 'Inventory'}>Prioritise existing stock <Icon name="arrow" size={15} /></button></article>
        </section>
        <section class="decision-strip"><div class="decision-symbol"><Icon name="bolt" size={23} /></div><div><strong>Small decisions. Smarter lab.</strong><p>Stock, expiry and budget checks run on rules. No AI calls needed.</p></div><div class="engine-meta"><span class="green-dot"></span>Rules engine ready<small>{lastLatency === null ? '14-day planning horizon' : `Last evaluation: ${lastLatency} ms · 0 model calls`}</small></div><button class="secondary" onclick={runCheck}><Icon name="reset" size={15} />Run stock check</button></section>
        <div class="overview-grid">
          <section class="panel procurement"><div class="panel-heading"><div><h2>Purchasing, with a human in the loop</h2><p>Only buy what upcoming experiments need.</p></div><button class="small-link" onclick={() => tab = 'Purchases'}>View all <Icon name="arrow" size={14} /></button></div>
            <div class="flow"><span class="done"><i>1</i>Need identified</span><b>→</b><span class:current={pending.length > 0}><i>2</i>Your approval</span><b>→</b><span><i>3</i>Pay & receive</span></div>
            <div class="table-scroll"><table><thead><tr><th>RESOURCE / SUPPLIER</th><th>ORDER VALUE</th><th>STATUS</th><th><span class="sr-only">Review</span></th></tr></thead><tbody>{#each activeOrders.slice(0, 4) as item}<tr><td><strong>{supplyName(item.supply)}</strong><small>{item.supplier}</small></td><td class="money-cell">{money(item.total)}</td><td><span class={`status ${item.status}`}>{statusLabel[item.status]}</span></td><td><button class="review-button" aria-label={`Review ${supplyName(item.supply)}`} onclick={() => openOrder(item.id)}><Icon name="arrow" size={17} /></button></td></tr>{:else}<tr><td colspan="4" class="empty-cell">All caught up. Run a stock check to review upcoming needs.</td></tr>{/each}</tbody></table></div>
            <div class="panel-note"><Icon name="shield" size={14} />Nothing is purchased without your approval.</div>
          </section>
          <section class="panel insight"><div class="insight-top"><span class="insight-icon"><Icon name="leaf" size={23} /></span><span class="eyebrow">LEAN LAB NOTE</span></div><h2>{atRisk.length ? 'The best purchase is the one you don’t need.' : 'Less stock sitting. More science moving.'}</h2><p>{atRisk.length ? `${atRisk[0].quantity} reactions of qPCR master mix expire on ${dateLabel(atRisk[0].expires)}. The rules engine allocates this batch first.` : 'Upcoming demand is checked against existing stock before any new order is proposed.'}</p><div class="mini-allocation"><span>Use existing stock</span><strong>First</strong><div><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i class="muted"></i><i class="muted"></i><i class="muted"></i></div><small>Expiry-aware allocation · no overordering by default</small></div><button class="insight-link" onclick={() => tab = 'Inventory'}>See your inventory <Icon name="arrow" size={16} /></button></section>
          <section class="panel"><div class="panel-heading"><div><h2>Next on the bench</h2><p>Experiments connected to every resource decision.</p></div><span class="count-tag">{upcoming.length} scheduled</span></div><div class="experiment-list">{#each upcoming.slice(0, 3) as exp}<button class="experiment-row" onclick={() => tab = 'Experiments'}><div class="date-tile"><span>{dateLabel(exp.date).split(' ')[1]}</span><strong>{dateLabel(exp.date).split(' ')[0]}</strong></div><div><strong>{exp.name}</strong><small>{exp.owner} <span>·</span> {exp.needs.length} resources</small></div><Icon name="chevron" size={16} /></button>{:else}<p class="empty-cell">No scheduled experiments. Add your next research plan.</p>{/each}</div></section>
          <section class="panel activity-panel"><div class="panel-heading"><h2>Decision trail</h2><span class="live-label"><span class="green-dot"></span>Local log</span></div><div class="activity-list">{#each lab.activity.slice(0, 3) as event}<div class="activity-item"><span class="activity-dot"></span><div><p>{event.text}</p><time>{event.time}</time></div></div>{/each}</div><button class="small-link export-link" onclick={exportLog}>Export audit log <Icon name="download" size={14} /></button></section>
        </div>
      {:else if tab === 'Purchases'}
        <div class="section-toolbar"><div class="filter-tabs">{#each ['Active', 'All'] as value}<button class:chosen={filter === value} onclick={() => filter = value}>{value}{#if value === 'Active'} <span>{activeOrders.length}</span>{/if}</button>{/each}</div><div class="toolbar-right"><span>{money(committed(lab))} committed</span><button class="secondary" onclick={runCheck}><Icon name="reset" size={16} />Run stock check</button></div></div>
        <section class="panel"><div class="table-scroll"><table><thead><tr><th>RESOURCE</th><th>QUANTITY</th><th>TOTAL</th><th>EXPECTED</th><th>STATUS</th><th></th></tr></thead><tbody>{#each (filter === 'Active' ? activeOrders : lab.orders) as item}<tr><td><strong>{supplyName(item.supply)}</strong><small>{item.supplier}</small></td><td>{item.quantity} {lab.supplies.find(s => s.id === item.supply)?.unit}</td><td class="money-cell">{money(item.total)}</td><td>{dateLabel(item.eta)}</td><td><span class={`status ${item.status}`}>{statusLabel[item.status]}</span></td><td><button class="secondary compact" onclick={() => openOrder(item.id)}>Review <Icon name="arrow" size={14} /></button></td></tr>{:else}<tr><td colspan="6" class="empty-cell">No active orders. Run stock check to evaluate planned experiments.</td></tr>{/each}</tbody></table></div></section>
        <div class="budget-summary"><Icon name="shield" size={20} /><p>Approval reserves funds. Simulated payment records spend. Receiving supplies updates inventory.</p><strong>{money(remaining(lab))} available</strong></div>
      {:else if tab === 'Inventory'}
        <div class="section-toolbar"><div class="search-box"><Icon name="search" size={17} /><input aria-label="Search inventory" placeholder="Find a resource…" bind:value={search} /></div><span class="muted-text">{lab.supplies.length} resources · earliest expiry first</span></div>
        <section class="panel"><div class="table-scroll"><table><thead><tr><th>RESOURCE</th><th>USABLE STOCK</th><th>14-DAY DEMAND</th><th>SHORTAGE</th><th>DECISION</th></tr></thead><tbody>{#each decisions.filter(d => d.supply.name.toLowerCase().includes(search.toLowerCase())) as d}<tr><td><strong>{d.supply.name}</strong><small>{d.supply.category} · {d.supply.supplier}</small></td><td>{d.available.toLocaleString()} <span class="muted-text">{d.supply.unit}</span></td><td>{d.demand.toLocaleString()}</td><td>{d.shortage || '—'}</td><td><span class={`status ${d.late ? 'failed' : d.shortage ? 'pending' : 'received'}`}>{d.late ? 'Delivery too late' : d.shortage ? 'Restock needed' : 'Covered'}</span></td></tr>{:else}<tr><td colspan="5" class="empty-cell">No matching resources.</td></tr>{/each}</tbody></table></div></section>
        <h2 class="standalone-heading">Batch register <span>Traceable stock. Expiry-aware decisions.</span></h2><div class="batch-grid">{#each lab.batches.filter(b => supplyName(b.supply).toLowerCase().includes(search.toLowerCase())) as batch}<article class="batch-card"><div><span class="batch-id">{batch.id}</span><span class={`status ${batch.expires < lab.today ? 'failed' : batch.expires <= datePlus(lab.today, 7) ? 'pending' : 'received'}`}>{batch.expires < lab.today ? 'Expired · excluded' : batch.expires <= datePlus(lab.today, 7) ? 'Use first' : 'In date'}</span></div><h3>{supplyName(batch.supply)}</h3><strong>{batch.quantity.toLocaleString()} <span>{lab.supplies.find(s => s.id === batch.supply)?.unit}</span></strong><small>Expires {dateLabel(batch.expires)} {batch.expires.slice(0, 4)}</small></article>{/each}</div>
      {:else}
        <div class="section-toolbar"><span class="muted-text">{lab.experiments.length} experiments · research linked to resources</span><button class="secondary" onclick={() => { modal = 'assistant'; error = ''; }}><Icon name="spark" size={16} />Draft with AI</button></div>
        <div class="experiment-cards">{#each lab.experiments as exp}<article class="panel experiment-card"><div class="experiment-card-top"><span class="experiment-code">{exp.id.startsWith('EXP') ? exp.id : `EXP-${exp.id.slice(0, 5).toUpperCase()}`}</span><span class={`status ${exp.status === 'planned' ? 'approved' : exp.status === 'completed' ? 'received' : 'rejected'}`}>{exp.status}</span></div><h2>{exp.name}</h2><div class="experiment-meta"><span>{exp.owner}</span><span><Icon name="clock" size={14} />{dateLabel(exp.date)}</span></div><p class="experiment-notes">{exp.notes || 'No protocol notes yet.'}</p><div class="needs-list">{#each exp.needs as need}<div><span>{supplyName(need.supply)}</span><strong>{need.quantity} {lab.supplies.find(s => s.id === need.supply)?.unit}</strong></div>{/each}</div><div class="experiment-actions">{#if exp.data}<a href={exp.data} target="_blank" rel="noreferrer"><Icon name="link" size={14} />{exp.data.includes('example.org') ? 'Example dataset link' : 'Open dataset'}</a>{:else}<span class="muted-text">No dataset linked</span>{/if}{#if exp.status === 'planned'}<button class="small-link" onclick={() => complete(exp.id, true)}>Cancel</button><button class="secondary compact" onclick={() => complete(exp.id)}>Complete <Icon name="check" size={14} /></button>{/if}</div>{#if exp.status === 'planned'}<small class="completion-note">Complete records planned quantities as actual use.</small>{/if}</article>{/each}</div>
      {/if}
      <footer class="page-footer"><span><span class="green-dot"></span>Science-led. Rules-driven. Human-approved.</span><span>LabFoundry / OpenFoundry</span></footer>
    </main>
  </div>
</div>

{#if toast}<div class="toast" role="status"><Icon name="check" size={18} /><span>{toast}</span><button aria-label="Dismiss notification" onclick={() => toast = ''}><Icon name="close" size={16} /></button></div>{/if}

{#if modal}
  <div class="modal-backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget && !assistantBusy) modal = null; }}>
    <div class="modal" role="dialog" aria-modal="true" aria-label={modal === 'order' ? 'Review purchase' : modal === 'assistant' ? 'Lab assistant' : modal === 'reset' ? 'Reset demo' : 'New experiment'} tabindex="-1" use:focusDialog onkeydown={(e) => { if (e.key === 'Escape' && !assistantBusy) modal = null; }}>
      <button class="modal-close icon-button" aria-label="Close dialog" onclick={() => modal = null}><Icon name="close" /></button>
      {#if modal === 'reset'}<div class="eyebrow">FRESH START</div><h2>Reset demo workspace?</h2><p>This clears changes saved in this browser and restores the fictional lab. Export your audit log first if you want to keep it.</p><div class="modal-actions"><button class="secondary" onclick={() => modal = null}>Keep changes</button><button class="primary" onclick={() => { lab = seed(); modal = null; toast = 'Demo restored. Ready for another walkthrough.'; }}>Reset demo</button></div>
      {:else if modal === 'order' && order}
        <div class="eyebrow">PURCHASE REVIEW / SIMULATED</div><h2>{supplyName(order.supply)}</h2><p>{order.supplier} · approved demo supplier</p><span class={`status ${order.status}`}>{statusLabel[order.status]}</span>
        <div class="order-facts"><div><span>Quantity</span><strong>{order.quantity} {lab.supplies.find(s => s.id === order.supply)?.unit}</strong></div><div><span>Expected delivery</span><strong>{dateLabel(order.eta)}</strong></div><div><span>Order total</span><strong>{money(order.total)}</strong></div><div><span>Available budget</span><strong>{money(remaining(lab))}</strong></div></div>
        <div class="reason-box"><Icon name="bolt" size={18} /><div><strong>Why this order?</strong><p>{order.reason}</p><small>Deterministic stock policy · 0 model calls</small></div></div>
        {#if error}<div class="form-error" role="alert">{error}</div>{/if}
        {#if role !== 'manager'}<p class="role-warning">Viewing as researcher. Switch demo role to lab manager to approve or process orders.</p>{/if}
        <div class="modal-actions">{#if order.status === 'pending'}<button class="secondary" disabled={role !== 'manager'} onclick={() => change('reject')}>Decline</button><button class="primary" disabled={role !== 'manager'} onclick={() => change('approve')}><Icon name="shield" size={17} />Approve {money(order.total)}</button>{:else if order.status === 'approved'}<button class="secondary" disabled={role !== 'manager'} onclick={() => change('reject')}>Cancel approval</button><button class="secondary" disabled={role !== 'manager'} onclick={() => change('fail')}>Simulate failure</button><button class="primary" disabled={role !== 'manager'} onclick={() => change('pay')}><Icon name="card" size={17} />Simulate payment</button>{:else if order.status === 'paid'}<button class="primary" disabled={role !== 'manager'} onclick={() => change('receive')}><Icon name="box" size={17} />Confirm simulated receipt</button>{:else}<button class="secondary" onclick={() => modal = null}>Done</button>{/if}</div><small class="modal-disclaimer">Demo prices include delivery and tax. No real purchase or payment is made. Receipt simulates full delivery with 180-day shelf life.</small>
      {:else if modal === 'experiment'}
        <div class="eyebrow">PLAN YOUR NEXT STEP</div><h2>New experiment</h2><p>Connect your experiment to its materials and data.</p>
        {#if draftNeeds}<div class="reason-box"><Icon name="spark" size={18} /><small>{assistantNote}</small></div>{/if}
        <form onsubmit={saveExperiment}><label>Experiment name<input required maxlength="120" placeholder="e.g. Protein expression pilot" bind:value={form.name} /></label><label>Scheduled date<input type="date" required min={lab.today} bind:value={form.date} /></label>{#if draftNeeds}<div class="needs-list">{#each draftNeeds as need}<div><span>{supplyName(need.supply)}</span><strong>{need.quantity}</strong></div>{/each}</div>{:else}<div class="form-row"><label>Resource<select bind:value={form.supply}>{#each lab.supplies as s}<option value={s.id}>{s.name} ({s.unit})</option>{/each}</select></label><label>Quantity<input type="number" min="1" max="1000000" step="1" required bind:value={form.quantity} /></label></div>{/if}<label>Protocol notes<textarea rows="2" placeholder="Approved protocol, context, or preparation notes" bind:value={form.notes}></textarea></label><label>Dataset or file link <span>(optional)</span><input type="url" placeholder="https://…" bind:value={form.data} /></label>{#if error}<div class="form-error" role="alert">{error}</div>{/if}<div class="modal-actions"><button type="button" class="secondary" onclick={() => modal = null}>Cancel</button><button class="primary" type="submit">Schedule experiment <Icon name="arrow" size={16} /></button></div></form>
      {:else if modal === 'assistant'}
        <div class="eyebrow">BOUNDED AI / DRAFTS ONLY</div><h2>A little help, before the bench.</h2><p>Describe an experiment and exact resource quantities. AI drafts the plan; rules check stock and budgets. You review before saving.</p><label class="assistant-label">Your request<textarea rows="5" bind:value={assistantText} placeholder="Plan an RNA pilot on 30 October using 100 pipette tips and 50 tubes."></textarea></label><div class="reason-box"><Icon name="shield" size={18} /><small>One model call. No purchasing access. Requires a server-side OpenAI API key; the rest of this demo works without one.</small></div>{#if error}<div class="form-error" role="alert">{error}</div>{/if}<div class="modal-actions"><button class="secondary" onclick={newExperiment}>Use form instead</button><button class="primary" disabled={assistantBusy || !assistantText.trim()} onclick={askAssistant}><Icon name="spark" size={16} />{assistantBusy ? 'Drafting…' : 'Draft experiment'}</button></div>
      {/if}
    </div>
  </div>
{/if}
