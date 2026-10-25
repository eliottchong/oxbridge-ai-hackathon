import type { PCRAnalysis, PCRExperimentOption, PCRMetrics, PCRObservation, PCROptionId } from '$lib/pcr-demo/types';
import { randomUUID } from 'node:crypto';
import { invalid } from '../preflight/errors';
export const THRESHOLDS = { background_ratio_percent: 20, target_cv_percent: 10, negative_target: 5 };
export function parsePCRCsv(csv: string): PCRObservation[] {
  if (csv.length > 65536 || !csv.trim()) throw invalid('Supply a CSV up to 64 KB.');
  const lines = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.shift() !== 'run_id,sample_id,condition,target_signal,background_signal,control_type') throw invalid('Use the six-column PCR demonstration CSV header.');
  if (lines.length !== 8) throw invalid('Supply exactly six specimens, one positive control and one negative control.');
  const rows = lines.map(line => {
    const cells = line.split(',');
    if (cells.length !== 6) throw invalid('Each observation must contain six unquoted CSV fields.');
    const [run_id, sample_id, condition, target, background, control_type] = cells.map(value => value.trim());
    if (![run_id, sample_id, condition].every(value => /^[A-Za-z0-9_. -]{1,80}$/.test(value))) throw invalid('Run, sample and condition identifiers must be short plain identifiers.');
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(target) || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(background)) throw invalid('Signals must be finite non-negative numbers.');
    const target_signal = Number(target), background_signal = Number(background);
    if (![target_signal, background_signal].every(value => Number.isFinite(value) && value <= 1e9)) throw invalid('Signals must be between zero and one billion.');
    if (!['none', 'positive', 'negative'].includes(control_type)) throw invalid('Control type must be none, positive or negative.');
    return { run_id, sample_id, condition, target_signal, background_signal, control_type } as PCRObservation;
  });
  if (new Set(rows.map(row => row.run_id)).size !== 1 || new Set(rows.map(row => row.sample_id)).size !== 8) throw invalid('Use one run ID and eight distinct sample IDs.');
  if (rows.filter(row => row.control_type === 'none').length !== 6 || rows.filter(row => row.control_type === 'positive').length !== 1 || rows.filter(row => row.control_type === 'negative').length !== 1) throw invalid('Supply six specimens and one of each control.');
  if (new Set(rows.filter(row => row.control_type === 'none').map(row => row.condition)).size !== 1) throw invalid('All six specimens must share one condition in this bounded demonstration.');
  return rows;
}
const descriptions: Record<PCROptionId, Omit<PCRExperimentOption, 'rank' | 'recommended'>> = {
  specificity: { id: 'specificity', title: 'Explore signal specificity', question: 'Can the desired signal be separated from the observed background?', rationale: 'Elevated background makes the apparent target signal harder to interpret.', expected_learning: 'Compare target and background in a fictional specificity-focused follow-up.', tradeoff: 'An improvement would support this direction, but would not establish a biological mechanism.', fixture_url: '/pcr-demo/specificity.csv' },
  consistency: { id: 'consistency', title: 'Explore result consistency', question: 'Does reducing between-sample variation make the pattern more reliable?', rationale: 'Variation between specimens makes the typical result less predictable.', expected_learning: 'Compare the spread of six fictional specimen signals with this round.', tradeoff: 'Lower variation can coexist with high background; repeatability alone does not establish specificity.', fixture_url: '/pcr-demo/consistency.csv' },
  'independent-repeat': { id: 'independent-repeat', title: 'Run an independent repeat', question: 'Does the observed pattern recur in another independent fictional run?', rationale: 'A separate run can test whether the observed pattern is stable enough to pursue.', expected_learning: 'Compare the new run descriptively with earlier rounds while keeping each run separate.', tradeoff: 'A repeat can establish recurrence in the scenario, but does not isolate its cause.', fixture_url: '/pcr-demo/independent-repeat.csv' }
};
export function analysePCR(rows: PCRObservation[], roundId: string, evidenceHash: string, previous?: PCRAnalysis): PCRAnalysis {
  const specimens = rows.filter(row => row.control_type === 'none');
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const target = mean(specimens.map(row => row.target_signal)), background = mean(specimens.map(row => row.background_signal));
  const variance = mean(specimens.map(row => (row.target_signal - target) ** 2));
  const positive = rows.find(row => row.control_type === 'positive')!, negative = rows.find(row => row.control_type === 'negative')!;
  const metrics: PCRMetrics = { specimen_count: 6, target_mean: target, background_mean: background, target_cv_percent: target > 0 ? Math.sqrt(variance) / target * 100 : null, background_ratio_percent: target > 0 ? background / target * 100 : null, positive_target: positive.target_signal, negative_target: negative.target_signal, negative_background: negative.background_signal };
  const highBackground = metrics.background_ratio_percent === null || metrics.background_ratio_percent > THRESHOLDS.background_ratio_percent;
  const variable = metrics.target_cv_percent === null || metrics.target_cv_percent > THRESHOLDS.target_cv_percent;
  const controlsFlag = negative.target_signal > THRESHOLDS.negative_target || positive.target_signal <= negative.target_signal;
  let ranking: PCROptionId[];
  let headline: string, interpretation: string;
  if (controlsFlag || target === 0) {
    ranking = ['independent-repeat', 'specificity', 'consistency']; headline = 'Resolve the control or signal limitation before interpreting this run';
    interpretation = 'The synthetic control screen or absent target signal limits interpretation. An independent repeat is the first proposed direction; this is not a diagnosis of contamination or assay failure.';
  } else if (highBackground) {
    ranking = ['specificity', ...(variable ? ['consistency', 'independent-repeat'] : ['independent-repeat', 'consistency'])] as PCROptionId[];
    headline = variable ? 'Background and variation both deserve investigation' : 'Specimen signals are consistent, while background remains a question';
    interpretation = 'The background-to-target ratio exceeds the declared demonstration threshold. A specificity-focused comparison is the strongest next question under this heuristic.';
  } else if (variable) {
    ranking = ['consistency', 'independent-repeat', 'specificity']; headline = 'Background is low; investigate the specimen variation';
    interpretation = 'The background screen is below the demonstration threshold, while specimen variability remains elevated. A consistency-focused comparison could be informative.';
  } else {
    ranking = ['independent-repeat', 'consistency', 'specificity']; headline = 'Low background and low specimen variation in these fictional results';
    interpretation = 'Both descriptive screens fall below the declared demonstration thresholds. An independent repeat is the next proposed check before extending the research claim.';
  }
  const format = (value: number | null) => value === null ? 'undefined because mean target is zero' : `${value.toFixed(1)}%`;
  const options = ranking.map((id, index) => ({ ...descriptions[id], rank: index + 1, recommended: index === 0 }));
  return { id: randomUUID(), round_id: roundId, evidence_hash: evidenceHash, created_at: new Date().toISOString(), metrics, headline, interpretation,
    observations: [`Mean target signal: ${target.toFixed(2)} arbitrary units across six specimens.`, `Mean background signal: ${background.toFixed(2)} arbitrary units; background-to-target ratio ${format(metrics.background_ratio_percent)}.`, `Population coefficient of variation for target signal: ${format(metrics.target_cv_percent)}.`, `Positive-control target: ${positive.target_signal}; negative-control target: ${negative.target_signal}. ${controlsFlag ? 'The declared control screen is flagged.' : 'No flag under the declared synthetic control screen.'}`],
    recommendation: `${options[0].title}: ${options[0].question}`,
    why_changed: previous ? `Compared with the previous round, mean target changed from ${previous.metrics.target_mean.toFixed(2)} to ${target.toFixed(2)}, background-to-target ratio from ${format(previous.metrics.background_ratio_percent)} to ${format(metrics.background_ratio_percent)}, and target CV from ${format(previous.metrics.target_cv_percent)} to ${format(metrics.target_cv_percent)}. ${previous.options[0].id === options[0].id ? 'The leading research direction remains the same.' : `The leading direction changes from “${previous.options[0].title}” to “${options[0].title}”.`} Each file is treated as a separate run; differences do not establish causation.` : null,
    limitations: ['All observations are fictional presentation data; the uploaded protocol contains no evidence for these outcomes.', 'The 20% background ratio, 10% population CV and negative-target >5 screens are arbitrary demo heuristics, not scientific acceptance criteria.', 'Six specimens in one condition provide descriptive summaries only; there are no statistical significance, biological validation or causal claims.', 'Experiment options describe research questions, not operational laboratory instructions. No experiment has been physically executed by this application.'],
    steps: [
      { id: 'validate', title: 'Validate the evidence', detail: 'Validated eight rows: six specimens, one positive control and one negative control, with unique sample IDs.', status: 'completed' },
      { id: 'summarise', title: 'Calculate signal summaries', detail: 'Calculated specimen means, population coefficient of variation, background-to-target ratio and the explicit synthetic control screen.', status: 'completed' },
      { id: 'compare', title: 'Compare with investigation memory', detail: previous ? 'Compared this run with the immediately preceding analysed round without pooling the observations.' : 'Established the first evidence snapshot for subsequent comparisons.', status: 'completed' },
      { id: 'rank', title: 'Rank the next research questions', detail: 'Applied the declared demonstration thresholds to rank three fictional extension experiments.', status: 'completed' }
    ], options };
}
