import type { WordExplanation } from '../../src/types/index.js';
import {
  analyzeGermanWordLocally,
  lookupDictionaryEntry,
} from '../../src/data/germanDictionary.js';
import {
  applyApiSecurityHeaders,
  readJsonBody,
  sendJson,
  VercelLikeRequest,
  VercelLikeResponse,
} from '../_lib/http.js';

const WIKTIONARY_USER_AGENT = 'DeutschMeisterApp/1.0 (https://deutschmeister.local; educational)';
const MAX_CACHE_ENTRIES = 1500;

interface LiveLookupResult {
  arabicMeanings: string[];
  ipa?: string;
  partOfSpeech?: string;
  article?: string;
  plural?: string;
  lemma?: string;
  source: 'wiktionary' | 'wikidata' | 'gtx';
}

const resolvedWordCache = new Map<string, WordExplanation>();
const inFlightLookups = new Map<string, Promise<WordExplanation>>();

function cacheWordResult(key: string, value: WordExplanation): void {
  if (resolvedWordCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = resolvedWordCache.keys().next().value;
    if (oldestKey) resolvedWordCache.delete(oldestKey);
  }
  resolvedWordCache.set(key, value);
}

function cleanWikiValue(raw: string): string {
  return raw
    .replace(/\[\[([^|\]]+\|)?([^\]]+)\]\]/g, '$2')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsArabicScript(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

function extractGermanSection(wikitext: string): string {
  // Prefer the German section (`== ... ({{Sprache|Deutsch}}) ==`) up to next `== ... ({{Sprache|` header
  const germanMatch = wikitext.match(
    /==[^\n]*\{\{Sprache\|Deutsch\}\}[^\n]*==([\s\S]*?)(?=\n==\s[^\n]*\{\{Sprache\||$)/i
  );
  return germanMatch ? germanMatch[1] : wikitext;
}

function parseWiktionaryArabic(section: string): {
  arabicMeanings: string[];
  ipa?: string;
  partOfSpeech?: string;
  article?: string;
  plural?: string;
  lemmaRef?: string;
} {
  const meaningsSet = new Set<string>();

  // Extract Arabic translations from {{Ü|ar|...}}, {{Üt|ar|...}}, {{Üxx4|ar|...}}
  const templateRegex = /\{\{(?:Üt|Ü|Üxx4?)\|ar\|([^|}]+)(?:\|[^}]*)?\}\}/gi;
  let m: RegExpExecArray | null;
  while ((m = templateRegex.exec(section)) !== null) {
    const cleaned = cleanWikiValue(m[1] || '');
    if (cleaned && containsArabicScript(cleaned)) {
      meaningsSet.add(cleaned);
      if (meaningsSet.size >= 6) break;
    }
  }

  // Extract IPA {{Lautschrift|...}}
  let ipa: string | undefined;
  const ipaMatch = section.match(/\{\{Lautschrift\|([^|}]+)\}\}/i);
  if (ipaMatch && ipaMatch[1]) {
    const rawIpa = cleanWikiValue(ipaMatch[1]);
    if (rawIpa) {
      ipa = rawIpa.startsWith('[') ? rawIpa : `[${rawIpa}]`;
    }
  }

  // Extract part of speech {{Wortart|Substantiv|Deutsch}} etc.
  let partOfSpeech: string | undefined;
  const posMatch = section.match(/\{\{Wortart\|([^|}]+)\|Deutsch\}\}/i);
  if (posMatch && posMatch[1]) {
    const rawPos = posMatch[1].trim();
    if (/substantiv/i.test(rawPos)) partOfSpeech = 'Nomen';
    else if (/verb/i.test(rawPos)) partOfSpeech = 'Verb';
    else if (/adjektiv/i.test(rawPos)) partOfSpeech = 'Adjektiv';
    else if (/adverb/i.test(rawPos)) partOfSpeech = 'Adverb';
    else if (/präposition/i.test(rawPos)) partOfSpeech = 'Präposition';
    else if (/konjunktion/i.test(rawPos)) partOfSpeech = 'Konjunktion';
    else partOfSpeech = rawPos;
  }

  // Extract Genus and Nominativ Plural from Substantiv table
  let article: string | undefined;
  const genusMatch = section.match(/\|Genus(?: 1)?\s*=\s*([mfn])\b/i);
  if (genusMatch) {
    const g = genusMatch[1].toLowerCase();
    article = g === 'm' ? 'der' : g === 'f' ? 'die' : g === 'n' ? 'das' : undefined;
  }

  let plural: string | undefined;
  const pluralMatch = section.match(/\|Nominativ Plural(?: 1)?\s*=\s*([^\n|]+)/i);
  if (pluralMatch && pluralMatch[1]) {
    const rawPlural = cleanWikiValue(pluralMatch[1]);
    if (rawPlural && rawPlural !== '—' && rawPlural !== '-' && rawPlural !== 'kein Plural') {
      plural = rawPlural.startsWith('die ') ? rawPlural : `die ${rawPlural}`;
    }
  }

  // Check lemma reference for inflected forms: {{Grundformverweis...|Lemma}} / {{Lemmaverweis|Lemma}}
  let lemmaRef: string | undefined;
  const lemmaMatch = section.match(
    /\{\{(?:Grundformverweis[^|}]*|Lemmaverweis)\|([^|}]+)/i
  );
  if (lemmaMatch && lemmaMatch[1]) {
    const candidate = cleanWikiValue(lemmaMatch[1]);
    if (candidate && /[a-zA-ZäöüÄÖÜß]/.test(candidate)) {
      lemmaRef = candidate;
    }
  }

  return {
    arabicMeanings: Array.from(meaningsSet),
    ipa,
    partOfSpeech,
    article,
    plural,
    lemmaRef,
  };
}

async function fetchWiktionaryPage(word: string, timeoutMs = 3500): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://de.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(
      word
    )}&prop=wikitext&format=json&redirects=1`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': WIKTIONARY_USER_AGENT,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json: any = await res.json().catch(() => null);
    const wt = json?.parse?.wikitext?.['*'];
    return typeof wt === 'string' && wt.length > 0 ? wt : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function lookupViaWiktionary(cleanWord: string): Promise<LiveLookupResult | null> {
  const capitalized = cleanWord.charAt(0).toUpperCase() + cleanWord.slice(1);
  const lower = cleanWord.toLowerCase();
  const candidates = Array.from(new Set([cleanWord, capitalized, lower]));

  for (const cand of candidates) {
    const wikitext = await fetchWiktionaryPage(cand);
    if (!wikitext) continue;
    const section = extractGermanSection(wikitext);
    const parsed = parseWiktionaryArabic(section);

    if (parsed.arabicMeanings.length > 0) {
      return {
        arabicMeanings: parsed.arabicMeanings,
        ipa: parsed.ipa,
        partOfSpeech: parsed.partOfSpeech,
        article: parsed.article,
        plural: parsed.plural,
        lemma: cand,
        source: 'wiktionary',
      };
    }

    // Follow 1-hop lemma reference if inflected (e.g. "ging" -> "gehen", "Häuser" -> "Haus")
    if (parsed.lemmaRef && parsed.lemmaRef.toLowerCase() !== cand.toLowerCase()) {
      const localLemmaHit = lookupDictionaryEntry(parsed.lemmaRef);
      if (localLemmaHit) {
        return {
          arabicMeanings: [
            localLemmaHit.contextMeaningArabic,
            ...(localLemmaHit.otherMeaningsArabic || []),
          ],
          ipa: parsed.ipa || localLemmaHit.ipa,
          partOfSpeech: parsed.partOfSpeech || localLemmaHit.partOfSpeech,
          article: parsed.article || localLemmaHit.nounInfo?.article,
          plural: parsed.plural || localLemmaHit.nounInfo?.plural,
          lemma: localLemmaHit.lemma,
          source: 'wiktionary',
        };
      }

      const lemmaWikitext = await fetchWiktionaryPage(parsed.lemmaRef);
      if (lemmaWikitext) {
        const lemmaSection = extractGermanSection(lemmaWikitext);
        const lemmaParsed = parseWiktionaryArabic(lemmaSection);
        if (lemmaParsed.arabicMeanings.length > 0) {
          return {
            arabicMeanings: lemmaParsed.arabicMeanings,
            ipa: parsed.ipa || lemmaParsed.ipa,
            partOfSpeech: lemmaParsed.partOfSpeech || parsed.partOfSpeech,
            article: lemmaParsed.article || parsed.article,
            plural: lemmaParsed.plural || parsed.plural,
            lemma: parsed.lemmaRef,
            source: 'wiktionary',
          };
        }
      }
    }
  }

  return null;
}

async function lookupViaWikidata(cleanWord: string, timeoutMs = 3000): Promise<LiveLookupResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
      cleanWord
    )}&language=de&uselang=ar&format=json&limit=4`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': WIKTIONARY_USER_AGENT,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json: any = await res.json().catch(() => null);
    const items: any[] = Array.isArray(json?.search) ? json.search : [];
    const lowerTarget = cleanWord.toLowerCase();

    const arabicLabels: string[] = [];
    for (const item of items) {
      const matchText = String(item?.match?.text || '').toLowerCase();
      const label = String(item?.label || '').trim();
      if (!label || !containsArabicScript(label)) continue;
      if (matchText === lowerTarget || arabicLabels.length === 0) {
        arabicLabels.push(label);
      }
      if (arabicLabels.length >= 3) break;
    }

    if (arabicLabels.length === 0) return null;
    return {
      arabicMeanings: Array.from(new Set(arabicLabels)),
      source: 'wikidata',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function lookupViaGoogleTranslate(cleanWord: string, timeoutMs = 2000): Promise<LiveLookupResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=de&tl=ar&dt=t&q=${encodeURIComponent(
      cleanWord
    )}`;
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json: any = await res.json().catch(() => null);
    const translated = Array.isArray(json?.[0])
      ? json[0].map((part: any) => String(part?.[0] || '')).join('').trim()
      : '';
    if (!translated || !containsArabicScript(translated)) return null;
    return {
      arabicMeanings: [translated],
      source: 'gtx',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveWordExplanation(cleanWord: string, sentence: string): Promise<WordExplanation> {
  const cacheKey = cleanWord.toLowerCase();
  const cached = resolvedWordCache.get(cacheKey);
  if (cached) {
    return { ...cached, word: cleanWord };
  }

  // 1. Offline expanded dictionary + German inflection/umlaut stems
  const dictHit = lookupDictionaryEntry(cleanWord);
  if (dictHit) {
    cacheWordResult(cacheKey, dictHit);
    return dictHit;
  }

  // 2. Live online German->Arabic lookup (Wiktionary -> Wikidata -> silent fallback)
  let live: LiveLookupResult | null = await lookupViaWiktionary(cleanWord);
  if (!live) {
    live = await lookupViaWikidata(cleanWord);
  }
  if (!live) {
    live = await lookupViaGoogleTranslate(cleanWord);
  }

  const baseMorphology = analyzeGermanWordLocally(cleanWord, sentence);
  if (!live || live.arabicMeanings.length === 0) {
    return baseMorphology;
  }

  const [primaryMeaning, ...otherMeanings] = live.arabicMeanings;
  const merged: WordExplanation = {
    ...baseMorphology,
    word: cleanWord,
    lemma: live.lemma || baseMorphology.lemma,
    partOfSpeech: live.partOfSpeech || baseMorphology.partOfSpeech,
    contextMeaningArabic: primaryMeaning,
    otherMeaningsArabic:
      otherMeanings.length > 0 ? otherMeanings : baseMorphology.otherMeaningsArabic,
    ipa: live.ipa || baseMorphology.ipa,
    nounInfo:
      live.article || live.plural
        ? {
            article: live.article || baseMorphology.nounInfo?.article,
            singular: `${live.article || baseMorphology.nounInfo?.article || ''} ${cleanWord}`.trim(),
            plural: live.plural || baseMorphology.nounInfo?.plural,
          }
        : baseMorphology.nounInfo,
  };

  cacheWordResult(cacheKey, merged);
  return merged;
}

export default async function handler(req: VercelLikeRequest, res: VercelLikeResponse) {
  applyApiSecurityHeaders(res);
  if (req.method !== 'POST') {
    return sendJson(res, 405, { success: false, error: 'Method not allowed' });
  }

  const body = await readJsonBody(req);
  const { word, sentence = '' } = body || {};
  if (!word || typeof word !== 'string' || !word.trim()) {
    return sendJson(res, 400, { success: false, error: 'Word is required' });
  }

  const cleanWord = word.trim().replace(/[.,!?;:„"“»«()]/g, '');
  if (!cleanWord) {
    return sendJson(res, 400, { success: false, error: 'Word is required' });
  }

  const lowerKey = cleanWord.toLowerCase();
  let pending = inFlightLookups.get(lowerKey);
  if (!pending) {
    pending = resolveWordExplanation(cleanWord, String(sentence)).finally(() => {
      inFlightLookups.delete(lowerKey);
    });
    inFlightLookups.set(lowerKey, pending);
  }

  const data = await pending;
  return sendJson(res, 200, { success: true, data });
}
