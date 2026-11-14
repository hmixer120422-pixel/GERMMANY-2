import type { WordExplanation } from '../types/index.js';

export declare function buildCoreGlossaryMap(
  phoneticGenerator?: (word: string) => string
): Record<string, WordExplanation>;
