import fs from "node:fs";

const raw = JSON.parse(fs.readFileSync("./lh-raw.json", "utf-8"));
const perf = raw.categories.performance;
const audits = raw.audits;

const weightedPenalties = perf.auditRefs
  .filter((ref) => ref.weight > 0)
  .map((ref) => {
    const audit = audits[ref.id] || {};
    return {
      metric: ref.id,
      weight: ref.weight,
      score: Math.round((audit.score ?? 0) * 100),
      displayValue: audit.displayValue ?? null,
    };
  })
  .filter((item) => item.score < 100)
  .sort((a, b) => a.score - b.score);

const culpritAudits = Object.entries(audits)
  .filter(
    ([_, a]) =>
      a.score !== null &&
      a.score < 1 &&
      !["notApplicable", "informative"].includes(a.scoreDisplayMode),
  )
  .map(([key, a]) => ({
    audit: key,
    title: a.title,
    score: a.score,
    displayValue: a.displayValue,
    culprits: (a.details?.items || []).slice(0, 3),
  }));

const deficit = {
  score: Math.round(perf.score * 100),
  weighted_penalties: weightedPenalties,
  culprit_audits: culpritAudits,
};

fs.writeFileSync("./deficit.json", JSON.stringify(deficit, null, 2));
console.log(JSON.stringify(deficit, null, 2));
