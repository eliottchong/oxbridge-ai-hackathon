# Synthetic research companion observations

These separately named engineering assets support the bounded research-loop demonstration. They do not replace or modify the data owner's SOP, inventory or independent ground truth. The data owner's final reviewed files take precedence. No physical experiment, biological measurement, instrument operation, stock use or purchase is implied by these files or their import.

Files are under `OpenFoundry/apps/web/static/research-companion/`. Each contains eight specimens and two controls, one measurement per specimen. Agent-visible CSVs contain observations only; the generating assumptions and independent expected results below are test documentation, not evidence to pass to the coordinator as a discovered explanation. No file is automatically imported into inventory.

## CSV contract

The exact ordered header is `run_id,specimen_id,sample_group,measurement_order,signal,is_control`. Identifiers contain 1–80 letters/digits/dots/colons/underscores/hyphens and start with a letter or digit. A file describes one run. Specimen IDs and positive integer measurement orders must be unique, including controls. Orders are bounded to 1–1000000; finite signals are bounded to +/-1e12. `is_control` must be the literal `true` or `false`. There are at most 2000 data rows and 64 KiB of UTF-8 input. Quoted single-line fields, CRLF and a leading UTF-8 BOM are supported; multiline fields and internal blank rows are rejected. `source_row` is the original physical CSV line (first observation = row 2).

Controls are retained, counted and validated against the design but excluded from group contrasts, regression and correlation. Their values are not a biological signal. Control acceptance limits are unspecified, so this tool does not claim control QC passed.

## Independent generating assumptions and expected calculations

All values use arbitrary synthetic signal units. No random process or instrument measurements were used.

| File | Specimen assumptions | Expected descriptive output |
| --- | --- | --- |
| `synthetic-initial.csv` | A occupies orders 1–4; B occupies 5–8. Signal = 10 + 2 × order. | A mean 15, B mean 23; B−A raw difference 8. Additive OLS is full rank and returns group coefficient 0, order slope 2, but the disjoint ranges remain allocation confounding. Classification `confounded`, both explanations unresolved. |
| `synthetic-followup.csv` | A orders 1,4,6,7; B orders 2,3,5,8. Signal = 10 + 2 × order. | Both groups have mean order 4.5 and mean signal 19; raw and adjusted difference 0; slope 2, order correlation 1. Classification `order_trend`. |
| `synthetic-no-signal.csv` | Same counterbalanced assignments; all specimen signals 10. | Raw/adjusted difference and slope 0; correlation undefined/null because signal variance is zero. Classification `no_clear_signal`; explanations unresolved. |
| `synthetic-sample-effect.csv` | Same counterbalanced assignments; A signal 10, B signal 18. | Raw/adjusted difference 8, slope 0, marginal order correlation 0. Classification `sample_effect`. |

All files have `CTRL-1` and `CTRL-2` at orders 9 and 10, both with signal 20. The counterbalanced manifest associates A-1..A-4 with orders 1,4,6,7 and B-1..B-4 with orders 2,3,5,8. Controls have group `CONTROL`. A follow-up import must match every assignment and preserve all eight specimens and two controls. The existing SOP's quantities, replicates and controls cannot be rewritten by this analysis.

## Transparent analysis and its limits

For two specimen groups with at least three observations each, the implementation fits `signal = intercept + group_B_indicator × group_coefficient + order × order_slope` using centered cross-products and the explicit 2×2 normal-equation inverse. Groups are sorted lexicographically, so group contrast means second group minus first. The marginal order correlation is Pearson's correlation across specimens; it is not the adjusted model coefficient.

If the centered design determinant is numerically zero (relative threshold 1e-12), group and order coefficients are not separately identifiable and are returned as null. Separately, disjoint group order ranges are classified as allocation confounding even when OLS has full rank. This distinguishes an algebraic issue from the unsupported model assumption required to extrapolate across groups. Equal mean group orders are labelled counterbalanced; this does not establish complete protection against nonlinear order effects.

When the design has overlap, signal labels are descriptive engineering heuristics: compare the absolute adjusted group coefficient and absolute fitted change over the observed specimen order range against `max(1e-9, 0.10 × observed specimen signal range)`. Exceeding both thresholds means `both_signals`, one means `sample_effect` or `order_trend`, neither means `no_clear_signal`. These are neither statistical tests nor significance levels, and depend on scale, outliers and the stated linear-additive assumptions. No probabilities, p-values, causal mechanism, scientific validity or discovery claim is provided. Designs with other than two groups or fewer than three observations per group remain `insufficient`.

Only a scientifically qualified human can review whether the synthetic illustration or a supplied real design is appropriate. Results can support a revised research direction; they cannot authorise equipment operations or mark a physical experiment performed.
