/**
 * Section tiers for REPOMAP.md output. Stable sections form the cache prefix
 * and are written first so the inference engine's KV cache stays warm across
 * regenerations. Volatile sections sit at the end so only the suffix
 * invalidates when the repo changes.
 */
export type Tier = 'stable' | 'semi' | 'volatile';

export interface SectionSpec {
  id: string;
  tier: Tier;
}

export const SECTION_ORDER: SectionSpec[] = [
  { id: 'overview', tier: 'stable' },
  { id: 'tech', tier: 'stable' },
  { id: 'architecture', tier: 'stable' },
  { id: 'patterns', tier: 'stable' },
  { id: 'modules', tier: 'semi' },
  { id: 'dependencies', tier: 'semi' },
  { id: 'co-changes', tier: 'volatile' },
  { id: 'hot-zones', tier: 'volatile' },
  { id: 'recent', tier: 'volatile' },
];

/** Order of removal when over token budget — most volatile dropped first. */
export const DROP_ORDER: string[] = ['recent', 'hot-zones', 'co-changes', 'dependencies', 'modules'];
