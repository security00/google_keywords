import type { Candidate, OrganizedCandidates } from "@/lib/types";

export const organizeCandidates = (candidates: Candidate[]) => {
  const risingCandidates = candidates.filter((candidate) => candidate.type === "rising");
  const seen = new Map<string, Candidate>();

  for (const candidate of risingCandidates) {
    const key = candidate.keyword.toLowerCase();
    const existing = seen.get(key);
    if (!existing || candidate.value > existing.value) {
      seen.set(key, candidate);
    }
  }

  const uniqueCandidates = Array.from(seen.values());
  const sortedCandidates = uniqueCandidates.sort((a, b) => {
    const scoreDiff = Number(b.score ?? 0) - Number(a.score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return b.value - a.value;
  });

  const organized: OrganizedCandidates = {
    explosive: [],
    fastRising: [],
    steadyRising: [],
    slowRising: [],
  };

  for (const candidate of sortedCandidates) {
    if (candidate.value > 500) {
      organized.explosive.push(candidate);
    } else if (candidate.value > 200) {
      organized.fastRising.push(candidate);
    } else if (candidate.value > 100) {
      organized.steadyRising.push(candidate);
    } else {
      organized.slowRising.push(candidate);
    }
  }

  return organized;
};

export const flattenOrganizedCandidates = (organized: OrganizedCandidates) => [
  ...organized.explosive,
  ...organized.fastRising,
  ...organized.steadyRising,
  ...organized.slowRising,
];
