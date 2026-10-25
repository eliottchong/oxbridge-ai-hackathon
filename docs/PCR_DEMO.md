# PCR research demonstration

The presentation starts from a real, user-supplied protocol document and clearly fictional observation files. The protocol provides context; the CSV files provide the numbers used in the analysis. No observations have been extracted from the protocol.

## Files and provenance

All downloadable inputs are in `OpenFoundry/apps/web/static/pcr-demo/` and served under `/pcr-demo/`.

| Input | Meaning |
| --- | --- |
| `PCR_protocol.pdf` | Unmodified, three-page NEB OneTaq routine PCR protocol supplied by the user. |
| `source.json` | Reviewed, display-only source facts and PDF identity. This is not output from the legacy protocol parser. |
| `initial.csv` | Fictional baseline results: visible target signal, substantial background and uneven specimen signals. |
| `specificity.csv` | Hypothetical follow-up illustration: much less background with visible target signal. |
| `consistency.csv` | Hypothetical follow-up illustration: more uniform target signals, with background still present. |
| `independent-repeat.csv` | Hypothetical follow-up illustration: the uneven baseline pattern recurs. |

The original PDF SHA-256 is `a5cda7064aba2db5449a195c8112779b4f8173593fc67c2d51096cf5f4c5feaf`; the public copy is byte-identical (205020 bytes). All three pages were visually inspected and their text checked. NEB is the source publisher; NEB has not supplied or validated the fictional observations or the demo conclusions.

The PDF contains variable template input and water-to-final-volume entries. It does not contain a specimen plan or complete material allocation. This demo must not claim stock readiness, full protocol extraction or approval, or an experiment physically performed. The source is general routine PCR guidance, without a named organism or target.

## The presentation story

Start a new demonstration and explain the two inputs: “This document tells the application what kind of protocol we are discussing. This separate observation file tells it what happened in our fictional example.”

The research question is: **Which follow-up would best improve our confidence in the quality of this fictional PCR signal?** Six specimen rows show a target-band signal alongside background. A positive and a negative control are displayed separately for context. These numbers are invented post-PCR band intensities in arbitrary units, not Ct values, qPCR measurements or clinical results.

The first analysis surfaces a visible target alongside substantial background and variability. It prepares three research choices for a scientist to review:

- **Explore specificity:** would a reviewed comparison reduce background while preserving the target signal? The demo's hypothetical results show a large background reduction. This supports prioritising confirmation of that cleaner signal, not declaring the assay validated.
- **Explore consistency:** would a reviewed comparison make specimen signals more uniform? The hypothetical results illustrate a more consistent signal while background remains. The next question becomes whether the remaining background can be addressed.
- **Repeat independently:** does the baseline pattern recur in another hypothetical run? The illustrative repeat retains variability and background. This supports further investigation of the pattern; it does not identify a mechanism.

Choose one option. Explain that the next file represents hypothetical results supplied for the presentation, then load the corresponding CSV. The application should associate those results with the selected option, recompute its descriptive analysis and update its suggestions. The previous results and decision should remain visible as investigation history.

For the clearest first presentation, choose **Explore specificity**, load `specificity.csv` and show the background dropping while the target remains visible. The other two files let the teammate demonstrate that different supplied evidence produces different interpretations. They are alternatives, not three experiments that actually took place.

## Exact observation contract

The ordered header is:

```csv
run_id,sample_id,condition,target_signal,background_signal,control_type
```

Each fixture contains exactly six specimen rows (`S1` through `S6`, `control_type=none`) and two control rows (`POS`, `control_type=positive`; `NEG`, `control_type=negative`). All rows within a file share a run and condition. The conditions are `baseline`, `specificity`, `consistency` and `independent-repeat`. The identifier `S1` is a demo row label; it does not establish biological identity or paired experimental design across files.

Specimen signals are the literal arrays below, assigned to S1-S6 in order. No random sampling, hidden instrument data or physical execution was involved. Every fixture has positive-control target/background values 100/5 and negative-control values 0/2. These control values are illustrative; no validated acceptance limits are supplied and the controls must not be described as having passed assay QC.

| File | Target signal | Background signal |
| --- | --- | --- |
| `initial.csv` | 58, 85, 60, 88, 56, 90 | 30, 36, 29, 39, 31, 35 |
| `specificity.csv` | 72, 75, 74, 73, 76, 74 | 8, 7, 9, 8, 7, 8 |
| `consistency.csv` | 82, 80, 83, 81, 82, 80 | 30, 31, 29, 30, 32, 31 |
| `independent-repeat.csv` | 61, 87, 59, 89, 62, 86 | 29, 34, 30, 35, 28, 34 |

## Independent arithmetic expectations

Exclude controls from specimen summaries. The mean target and mean background are ordinary arithmetic means over the six specimen rows. Population target CV is `100 × population standard deviation(target) / mean(target)`. Background fraction is `100 × mean(background) / mean(target)`; this is a descriptive signal ratio, not a biochemical specificity measurement.

| File | Mean target (AU) | Mean background (AU) | Population target CV | Background / target |
| --- | ---: | ---: | ---: | ---: |
| Initial | 72.8333 | 33.3333 | 20.5249% | 45.7666% |
| Specificity | 74.0000 | 7.8333 | 1.7446% | 10.5856% |
| Consistency | 81.3333 | 30.5000 | 1.3593% | 37.5000% |
| Independent repeat | 74.0000 | 31.6667 | 18.0967% | 42.7928% |

These are deterministic demo inputs deliberately chosen to make the three paths distinguishable. Labels and recommendation thresholds are presentation heuristics, not statistical significance tests, probabilities or validated scientific quality thresholds. The data do not support causality, assay optimisation, clinical claims or generalisation. Options are non-operational research questions; no thermal program, organism-specific design, new wet-lab recipe or execution authorisation is generated by this fixture pack.

## Scope and continuity

This fixture pack is separately named. It does not replace the data owner's original fixtures, protocol or inventory, and does not change any stock or consumption record. Selecting an option or importing a hypothetical result must not mark an experiment completed in the physical laboratory. A fresh demonstration should create a new investigation, preserving earlier presentation runs and team data.
