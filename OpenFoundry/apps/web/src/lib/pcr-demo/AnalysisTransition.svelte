<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$lib/lab/Icon.svelte';

  let { calculating, filename, oncomplete }: {
    calculating: boolean;
    filename: string;
    oncomplete: () => void;
  } = $props();
  let phase = $state(0);
  const captions = ['Connecting your evidence', 'Bringing the pattern into focus', 'Connecting the next research question', 'Preparing your analysis'];

  onMount(() => {
    const phases = window.setInterval(() => { phase = Math.min(phase + 1, captions.length - 1); }, 1250);
    const finish = window.setTimeout(oncomplete, 5000);
    return () => { window.clearInterval(phases); window.clearTimeout(finish); };
  });
</script>

<section class="analysis-transition" aria-label="Preparing the analysis view" aria-busy="true">
  <div class="transition-grid" aria-hidden="true"></div>
  <span class="transition-kicker">LABRELAX / EVIDENCE TO INSIGHT</span>
  <div class="signal-map" aria-hidden="true">
    <div class="signal-halo"></div>
    <svg class="signal-lines" viewBox="0 0 480 190" fill="none">
      <path class="signal-track" d="M28 95H112L178 44H240L302 146H366L452 95" />
      <path class="signal-track secondary" d="M28 95H112L178 146H240L302 44H366L452 95" />
      <path class="signal-flow" d="M28 95H112L178 44H240L302 146H366L452 95" />
      <path class="signal-flow secondary" d="M28 95H112L178 146H240L302 44H366L452 95" />
      {#each [[28,95],[112,95],[178,44],[178,146],[302,44],[302,146],[366,95],[452,95]] as point, index}
        <circle class="signal-node" cx={point[0]} cy={point[1]} r="5" style={`--node-delay:${index * 0.16}s`} />
      {/each}
    </svg>
    <div class="signal-core"><Icon name="spark" size={34} /></div>
  </div>
  <h2>Every result opens<br />a new question.</h2>
  <p class="transition-caption" role="status">{captions[phase]}<span class="transition-dots" aria-hidden="true">…</span></p>
  <div class="transition-stages" aria-hidden="true">
    {#each ['Evidence', 'Patterns', 'Next step'] as label, index}
      <span class:lit={phase >= index}><i></i>{label}</span>
      {#if index < 2}<b>→</b>{/if}
    {/each}
  </div>
  <div class="transition-progress" aria-hidden="true"><span></span></div>
  <p class="transition-status"><Icon name={calculating ? 'clock' : 'check'} size={13} />{calculating ? 'Calculating from your observations' : 'Calculations saved · preparing the view'}</p>
  <small>{filename}</small>
</section>

<style>
  .analysis-transition { position: relative; isolation: isolate; overflow: hidden; display: flex; align-items: center; flex-direction: column; justify-content: center; min-height: 520px; padding: 42px 24px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); text-align: center; animation: transition-enter .35s ease-out both; }
  .transition-grid { position: absolute; z-index: -2; inset: 0; opacity: .42; background-image: linear-gradient(var(--line) 1px, transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px); background-size: 32px 32px; mask-image: radial-gradient(ellipse at center,black,transparent 72%); }
  .transition-kicker { color: var(--green); font-size: 10px; letter-spacing: .16em; }
  .signal-map { position: relative; width: min(480px,100%); height: 174px; margin: 12px 0 5px; }
  .signal-halo { position: absolute; width: 132px; height: 132px; left: 50%; top: 50%; border: 1px solid var(--line); border-radius: 50%; transform: translate(-50%,-50%); box-shadow: 0 0 0 22px color-mix(in srgb,var(--green) 3%,transparent),0 0 0 44px color-mix(in srgb,var(--green) 2%,transparent); animation: halo-breathe 2.2s ease-in-out infinite; }
  .signal-lines { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  .signal-track { stroke: var(--green); stroke-width: 1.5; opacity: .15; }
  .signal-flow { stroke: var(--green); stroke-width: 2.4; stroke-dasharray: 40 490; stroke-linecap: round; animation: signal-travel 2s linear infinite; }
  .signal-flow.secondary { opacity: .5; animation-delay: -.9s; }
  .signal-node { fill: var(--surface); stroke: var(--green); stroke-width: 1.5; animation: node-glow 1.8s ease-in-out infinite; animation-delay: var(--node-delay); }
  .signal-core { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); display: grid; place-items: center; width: 76px; height: 76px; color: var(--green); border: 1px solid var(--green); border-radius: 22px; background: var(--green-soft); box-shadow: 0 8px 35px color-mix(in srgb,var(--green) 12%,transparent); }
  .analysis-transition h2 { margin: 0; font-size: 32px; font-weight: 500; line-height: 1.25; letter-spacing: -.04em; color: var(--ink); }
  .transition-caption { min-height: 24px; margin: 18px 0 22px; font-size: 13px; line-height: 1.7; color: var(--muted); }
  .transition-dots { display: inline-block; animation: dots-breathe 1s ease-in-out infinite; }
  .transition-stages { display: flex; align-items: center; gap: 14px; color: var(--muted); font-size: 11px; }
  .transition-stages span { display: flex; align-items: center; gap: 7px; opacity: .45; transition: opacity .4s,color .4s; }
  .transition-stages .lit { color: var(--green); opacity: 1; }
  .transition-stages i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
  .transition-stages b { font-weight: 400; opacity: .4; }
  .transition-progress { width: min(280px,80%); height: 3px; overflow: hidden; margin: 25px 0 17px; border-radius: 4px; background: var(--line); }
  .transition-progress span { display: block; width: 100%; height: 100%; border-radius: inherit; background: var(--green); transform-origin: left; animation: transition-fill 5s linear both; }
  .transition-status { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 0; font-size: 10px; color: var(--muted); line-height: 1.6; }
  .analysis-transition small { display: block; max-width: 100%; overflow-wrap: anywhere; margin-top: 6px; color: var(--muted); font-size: 10px; opacity: .65; }
  @keyframes transition-enter { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes signal-travel { from { stroke-dashoffset: 530; } to { stroke-dashoffset: 0; } }
  @keyframes node-glow { 0%,100% { fill: var(--surface); } 50% { fill: var(--green-soft); stroke-width: 2.5; } }
  @keyframes halo-breathe { 0%,100% { opacity: .5; scale: .96; } 50% { opacity: 1; scale: 1.04; } }
  @keyframes dots-breathe { 0%,100% { opacity: .3; } 50% { opacity: 1; } }
  @keyframes transition-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @media (max-width: 650px) { .analysis-transition { min-height: 470px; padding: 32px 20px; } .analysis-transition h2 { font-size: 27px; } .transition-stages { gap: 9px; } }
  @media (prefers-reduced-motion: reduce) { .analysis-transition,.signal-halo,.signal-flow,.signal-node,.transition-dots,.transition-progress span { animation: none; } .signal-flow { opacity: .35; } .transition-stages span { transition: none; } }
</style>
