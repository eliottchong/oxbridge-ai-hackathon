# LabRelax: from research results to the next experiment

Build handoff, 25 October 2026. This document specifies the next implementation; it does not describe features already shipped.

## Product decision

**Pitch: “LabRelax turns yesterday’s results into tomorrow’s experiment.”**

LabRelax is a research partner for a small lab. A scientist supplies a research goal. The agent examines that lab’s evidence, proposes testable explanations, performs useful computational work, and prepares the next informative experiment using the lab’s reviewed protocols and recorded resources. When new results arrive, it revises the investigation and recommends the next step.

Build one continuous investigation. Research ideas, experiment readiness and experiment history must feel like successive stages of the same task. The existing preflight becomes the bridge between an idea and an executable plan; the existing usage/history becomes part of the context for interpreting later results.

The vision includes proposing new research directions. The hackathon demonstrates one bounded investigation, with two competing explanations and one supported follow-up design. Demonstrating this loop well takes priority over expanding domains or adding a broad idea portfolio.

## Consensus from the product debate

Three agents debated narrative, scope and implementation feasibility. They converged on an unexpected or promising result as the opening, rather than a blank brainstorming box. A shortage is a useful constraint, but scientific evidence changing the next recommendation is the main payoff.

The final synthesis deliberately avoids requiring a dramatic reversal. If the original observations cannot distinguish two explanations, the agent must say so. The payoff can be a justified transition from uncertainty to stronger support after better evidence, rather than an invented initial conviction.

The loop is:

**Goal → observations → competing explanations → real analysis → informative follow-up → material preflight → reviewed result → revised next step.**

Autonomy means the agent completes its authorised desk work and plan preparation without repeated prompts. A scientist reviews physical experiment design and execution. Physical instruments are not connected in this build.

## Hero story and stage demonstration

**Research question: “Is this apparent sample effect real, or caused by measurement order?”**

1. A researcher opens an investigation containing a promising difference in an earlier, explicitly synthetic microplate dataset. The active goal is to determine whether the difference is reproducible.
2. The agent notices that sample group and measurement order are confounded. It proposes two testable explanations: a sample-associated effect and an order-associated artefact. Each explanation points to the actual observation rows and relevant reviewed notes.
3. The agent chooses and runs a real, bounded analysis tool. The tool reports that the original design cannot separate the explanations. The agent proposes a reviewed counterbalanced follow-up, retaining the existing SOP’s quantities, controls and complete specimen design.
4. The agent calls the existing preflight. The same investigation displays what the follow-up tests and whether recorded materials cover it. The scientist reviews the proposal and protocol assumptions. Actual-use confirmation remains a separate action for a performed run.
5. The presenter imports a clearly labelled synthetic follow-up dataset, representing a later observation in the demonstration. The agent analyses it and updates the explanations and next recommendation. Explain that no physical experiment was performed by the application.

Define the final payoff explicitly: if the follow-up supports an order trend rather than a remaining group difference, recommend **“Investigate the measurement-order trend before pursuing the sample effect.”** Save this as an evidence-linked next research direction pending design review. It is not a second ready physical experiment: only the single follow-up with the reviewed manifest can receive that status. Different supplied results must produce a correspondingly different direction, including remaining unresolved when neither explanation has support.

The main stage scenario should have enough independently supplied baseline stock for the complete reviewed design. Do not force a shortage into the climax. A shortage variant may show the same design remaining blocked while retrospective analysis continues; it must not manufacture a purchase, receipt or physical run.

Do not solve a shortage by changing eight specimens to six, dropping controls or reducing replicates. The preflight’s numerical what-if is not authority to alter a scientific design.

Suggested 90-second arc: 15 seconds for the research question and observed pattern; 25 seconds for the agent’s analysis and uncertainty; 20 seconds for the follow-up and embedded preflight; 20 seconds for the new result and updated recommendation; 10 seconds for the persistent investigation and closing pitch.

## Existing foundation: reuse it

Repository: https://github.com/eliottchong/oxbridge-ai-hackathon

Inspected local checkout: `/Users/yee/Documents/oxbridge-ai-hackathon`.

Verified starting branch: `codex/labrelax-backend`; inspected HEAD: `0192bfe`. Start from that branch or a descendant containing its backend, not from the earlier procurement demo on another branch. Check current status and new changes before editing; preserve other contributors’ work.

Read `README.md`, `docs/BACKEND_HANDOFF.md` and `docs/VERIFICATION.md` first.

The current app already provides:

- A SvelteKit interface at `/lab` and authenticated APIs under `/api/lab`.
- Supported PDF transcription, source excerpts and explicit protocol review.
- Fixed-point material calculations, resource previews and stock revisions.
- Transactional actual-use confirmation, idempotency and experiment continuity.
- Persistent SQLite storage and a single provisioned project/session model.

Reuse those components. The existing experiment status `completed` means consumption has been confirmed; it does not mean scientific results have been uploaded or interpreted. Introduce separate investigation, analysis and outcome states.

OpenFoundry currently supplies the application scaffold. Its Rust services, connectors and ontology APIs are not integrated into this flow. Represent the new relationships in the existing application database; describe them accurately as LabRelax’s investigation model. Do not start the Rust stack or claim the OpenFoundry ontology is operational. Full ontology integration is later work.

Do not reconnect `src/lib/lab/model.ts`: it belongs to the older simulated procurement demo, not the current transactional backend.

## Experience to build

Make an **Investigation** the main entry point. Keep existing preflight, inventory and history accessible as supporting views.

The investigation screen should answer four plain-language questions:

- **What are we trying to learn?** Goal, original observation and source.
- **What could explain it?** Two explanation cards with evidence and uncertainty.
- **What happens next?** One recommended action, what it would distinguish, agent progress and material readiness.
- **What changed?** New observations, previous interpretation and revised next step.

Embed the current protocol review/preflight in the proposal flow, using existing services and shared components. Do not build a second calculator or make users re-upload a linked protocol. Show concise completed actions such as “Compared groups”, “Checked measurement order” and “Checked materials”, with expandable source/output evidence. Avoid internal agent-role conversations and technical prompts in the product UI.

Suggested actions: **Investigate**, **Review proposed experiment**, **Add result**. Keep actual-use confirmation explicitly separate. A result upload must work without forcing or inventing a consumption event.

Preserve the question, rejected or weakened explanations and the reason for each revision. This persistent scientific context is what makes the prototype point toward managing research ideas over time.

## Data ownership and demonstration contract

The teammate remains owner of the final SOP, inventory and independent ground truth. Do not regenerate or overwrite those assets. Current `static/fixtures/` files are temporary engineering references, and no scientific result dataset currently exists.

Request/use companion initial and follow-up result files from the data owner. To avoid blocking the build, the implementing agent may add separately named, explicitly synthetic companion CSVs with documented deterministic assumptions, preserving the teammate’s assets. Keep analysis expected answers separate from agent-visible evidence.

Use one reviewed design manifest linking the investigation, protocol version, full specimen/control counts and counterbalanced sample assignment/order. The manifest is new metadata; it does not authorise the model to rewrite SOP quantities. A qualified teammate must review its scientific interpretation before pitching it as more than a synthetic illustration.

Suggested CSV contract: `run_id`, `specimen_id`, `sample_group`, `measurement_order`, `signal`, `is_control`. A small import form/manifest supplies source type, protocol version and optional existing experiment ID. Validate identifiers, unique order, finite readings, counts and group labels. Analyse specimens and controls according to the declared design; never silently treat controls as extra experimental samples.

Initial observations must intentionally confound group with order. Follow-up observations must counterbalance them and allow a different, more informative conclusion. For example, the follow-up can contain an order trend without a remaining group difference. Define the generating assumptions and expected calculations explicitly; present them as a synthetic demonstration, not a discovered biological mechanism.

Tag evidence as imported measurement, synthetic observation, simulation output, reviewed note or literature excerpt. Retain original file/content hash, source rows, import time and actor. Imported past observations do not imply inventory was deducted in this workspace. A follow-up import is a demonstration of later evidence, not proof that the software performed the physical experiment.

For the first build, use a small reviewed evidence pack with genuine source pointers. Mark scenario notes as synthetic. Live literature search is an extension only after the full loop works; do not invent citations or present source retrieval as shipped when it is absent.

## Minimum implementation boundaries

All following web paths are relative to `OpenFoundry/apps/web/`.

1. Add shared research types in `src/lib/research/types.ts` and focused server modules under `src/lib/server/research/` for the service, deterministic analysis and agent orchestration.
2. Extend `src/lib/server/preflight/store.ts` additively, or use an additive migration invoked by it. Persist investigations, hypothesis revisions, evidence/results, analysis outputs, proposals and agent runs/steps. Reuse the database; do not replace or reset existing stock/ledger tables.
3. Link proposals to existing `experiment_id` and `plan_id`, and persist the exact hypothesis revision/evidence snapshot used. Missing historical experiment links remain explicit. Every relationship must stay within the permitted project.
4. Extend `src/routes/api/lab/[...path]/+server.ts` with investigation creation/read, evidence import, bounded investigation run, proposal review and result-triggered re-analysis. Reuse current authentication, project restrictions, request bounds, CSRF and error handling. Keep research logic in its own service.
5. Add investigation components under the app’s existing component structure and compose them into `src/routes/lab/+page.svelte`. Extract shared preflight UI only as needed; preserve the existing workflow.

Persist separate states for an investigation, a proposed physical experiment and an agent job. The reviewed proposal is distinct from a model draft; a ready material preview is distinct from a scientifically valid design; an imported result is distinct from actual use.

Each analysis result needs input evidence IDs/hash, tool/version, parameters, output and explicit limitations. Each hypothesis revision needs the supporting/contradicting evidence IDs and reason for change. Avoid fake probability percentages. Use qualitative labels such as unresolved, weakened and provisionally supported, supported by the tool output.

## Agent behaviour: real actions, bounded scope

Use one coordinator with a short critique step; multiple conversational personas are not required. It receives the goal, permitted evidence and reviewed design options. It selects and invokes real tools, critiques its inference, prepares the follow-up and records why the new evidence changes the next step.

Minimum allowlisted tools:

- Read the investigation’s permitted evidence and linked experiment history.
- Run the deterministic result analysis.
- Inspect the reviewed follow-up design and approved protocol.
- Call `LabService.preview()` for that complete design.
- Save an evidence-linked draft proposal/hypothesis revision.

The fixed analysis should calculate transparent group contrasts and order associations, detect rank deficiency/confounding when fitting both, and report when the data cannot distinguish explanations. It must not claim a causal discovery or use a simulator to prove the assumptions that generated its own data. No arbitrary generated code execution is needed.

Use the existing server-side provider configuration pattern with structured output and tool schemas. Choose finite defaults, for example at most six tool calls, 60 seconds and bounded model output. Persist running/completed/failed state and completed tool outputs. Support a short request/poll pattern if required. Retry must not duplicate plans or overwrite reviewed evidence; carry a run/proposal idempotency key.

The coordinator cannot approve a protocol, confirm consumption, alter stock, purchase items, send messages or operate equipment. Once the researcher starts an investigation, complete the permitted analysis/preparation without asking approval at every tool call. Stop at a reviewable physical experiment proposal.

No-key mode must clearly say **scripted walkthrough**. It must not masquerade as a live autonomous run. The deterministic analysis and material check should still execute on the actual supplied data. Missing/ambiguous evidence produces a request for that evidence or an unresolved conclusion, not a fabricated result.

If inventory has changed, re-run preflight and invalidate the displayed old readiness. A shortage stays attached to the full scientific design. Existing baseline import is not a replenishment mechanism and cannot be used to erase consumption history.

## Build sequence and completion gates

### 1. Freeze the story and inputs

Select one investigation, review the complete follow-up design, agree the two result-file contracts and ensure the main demo baseline can cover the full design. Record which files are teammate-owned and which are synthetic companion assets. Preserve the existing supported SOP contract.

### 2. Make evidence and scientific memory real

Implement persistence, project-scoped evidence import, analysis and hypothesis/proposal revisions. Verify the initial confounding is detected and the counterbalanced follow-up yields the expected different support. Restarting must preserve the investigation. Import/analysis must leave stock unchanged.

### 3. Connect an actual agent to the existing preflight

The coordinator must really invoke analysis and `LabService.preview()`, consume their returned outputs and save a sourced recommendation. Its tool log must demonstrate those calls. Protocol/physical plan approval remains a scientist action. Handle missing keys, model timeout and insufficient evidence visibly.

### 4. Deliver one continuous investigation view

Complete the five-beat demonstration in one main view. Link out to the original source, exact preflight and actual-use history as needed. The final screen explains what changed and why the next research direction is different; any additional physical design remains pending review. Update the README’s product description and scope to match the implementation actually delivered.

### 5. Verify the story against counterexamples

Run existing and new meaningful tests, type checks and production build. The root `pnpm test` currently targets only `src/lib/server/preflight`; extend it to include research tests, preserving current coverage. Verify the five-beat story in the browser using a disposable demo database, not a destructive reset of the shared workspace.

Required checks: malformed/result-count inputs; cross-project evidence links; original confounding; a follow-up with no signal; changed results causing a changed interpretation; persisted source provenance; no stock changes from imports/agent runs; no automatic actual-use confirmation; stale readiness; idempotent/replayed job actions; and clean failure when the model is unavailable. Preserve the existing tests of transactional actual use.

Completion means the real analysis and planning loop works on labelled synthetic data. Record whether a real provider-backed agent run was verified. Do not claim that physical experiments, general scientific validity or new discoveries were demonstrated.

## Borrowed processes and deliberate limits

- Google Co-Scientist: generate competing hypotheses, criticise them and refine the proposal. https://deepmind.google/blog/co-scientist-a-multi-agent-ai-partner-to-accelerate-research/
- FutureHouse Robin: feed experimental observations back into the next hypothesis/experiment cycle. https://www.futurehouse.org/research/demonstrating-end-to-end-scientific-discovery-with-robin-a-multi-agent-system
- Owkin: connect direction prioritisation to whether the available lab can test it. https://www.owkin.com/blog/how-owkin-narrows-the-search-space-in-aging-research
- Edison: preserve links from conclusions back to the data and analysis that produced them. https://edisonscientific.com/news/announcing-kosmos

These are useful precedents, not claims that LabRelax invented the workflow. The hackathon claim is a coherent, inspectable next-experiment loop built on the existing resource and evidence foundation.

Defer general autonomous discovery, multi-program portfolios, unlimited web research, manuscript writing, new instrument integrations, ordering/payments, general PDF understanding and a new infrastructure stack. First ship one investigation whose next action genuinely changes with new evidence.
