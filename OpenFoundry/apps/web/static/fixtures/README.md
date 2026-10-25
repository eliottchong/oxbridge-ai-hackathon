# Temporary engineering test fixtures

**These files are temporary synthetic engineering test inputs, not the final team demo dataset.**
The teammate-owned, independently checked final dataset takes precedence. No real laboratory,
patient or private data is present. These files should not be described as customer evidence.

- `synthetic_microplate_sop.pdf`: one supported, machine-readable synthetic template.
- `synthetic_inventory.csv`: temporary recorded-stock example with explicit units, thresholds and lot IDs.
- `ground_truth.json`: independent expected arithmetic for tests/judges. The protocol parser does not read it.
- `unsupported_protocol.pdf`: free-form layout that must not be accepted.
- `scanned_protocol.pdf`: no supported machine-readable body; must not be accepted (OCR is not implemented).
- `injected_protocol.pdf`: source instruction to bypass safeguards; must remain untrusted text and force review.
- `ambiguous_protocol.pdf`: two possible reagent quantities; parser must not choose one.
- `contradictory_protocol.pdf`: per-batch footnote contradicting the table; must force review.

Generation helper: `scripts/generate-preflight-fixtures.py` (ReportLab required).
Do not regenerate over teammate-supplied final fixtures.

## Supported temporary layout

Single-column text layer, with one line per field or table row:

```text
Synthetic Microplate Readout SOP v1.0
Protocol ID: SYN-MICROPLATE-001
Version: 1.0
Supported layout: LABRELAY-PREFLIGHT-1
Sample count means test specimens, excluding controls.
Replicates per specimen: 1
Fixed controls: 2
Preparation overage: 10%
Resource | Per reaction | Unit
Buffer A | 60 | uL
Indicator B | 15 | uL
Wash C | 100 | uL
Notes:
Researcher approval is required before planning.
Preparation overage does not imply actual consumption.
Recorded inventory is not a measurement of physical stock.
```

Amounts are read from actual PDF text, never copied from this README or the answer key.
The parser permits changed positive decimal amounts and volume units; unknown reagents,
missing fields, duplicate rows, ambiguous values and unexpected text require review.
Successful supported-template extraction is still an unapproved draft.
