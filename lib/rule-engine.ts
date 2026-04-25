/**
 * Enhanced rule engine for keyword pre-filtering.
 * Replaces LLM for obvious cases, reducing AI cost by 60-70%.
 */
import { randomUUID } from "crypto";

export type RuleResult = {
  action: "keep" | "block" | "demote";
  reason: string;
  score: number; // -100 to 100, higher = better
};

/**
 * Score a keyword based on rules. No API calls needed.
 */
export function scoreKeyword(keyword: string): RuleResult {
  const text = keyword.trim();
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // --- Hard blocks (action: block) ---

  // Empty / too short / too long
  if (!text || lower.length < 3) return { action: "block", reason: "too_short", score: -100 };
  if (lower.length > 60) return { action: "block", reason: "too_long", score: -100 };
  if (wordCount >= 7) return { action: "block", reason: "too_many_words", score: -100 };

  // Pure numbers
  if (/^\d+$/.test(text)) return { action: "block", reason: "pure_number", score: -100 };

  // Question-style
  if (/[?？]/.test(text)) return { action: "block", reason: "question", score: -100 };

  // Dictionary / language queries
  if (/\b(meaning|definition|riddle|crossword|puzzle|word game|etymology|spelling|pronunciation)\b/i.test(lower))
    return { action: "block", reason: "dictionary_query", score: -80 };

  // Places / landmarks
  if (/\b(city|country|airport|station|port|park|temple|church|mountain|river|lake|island|capital)\b/i.test(lower))
    return { action: "block", reason: "place", score: -60 };

  // Login / auth pages
  if (/\b(login|sign in|sign up|register|log in|auth|portal)\b/i.test(lower))
    return { action: "block", reason: "auth_page", score: -80 };

  // Spam, gambling, adult, and suspicious domain-like queries
  if (/\b(casino|casinos|gambling|betting|sportsbook|lottery|slot|slots|bet slip|odds|aams|echtgeld|casinovergleich)\b/i.test(lower))
    return { action: "block", reason: "gambling", score: -100 };
  if (/\b[a-z0-9-]+\.(com|net|org|de|it|io|co|site|shop|xyz|th)\b/i.test(lower))
    return { action: "block", reason: "domain_spam", score: -100 };
  if (/\b(porn|xxx|adult|escort|onlyfans|nsfw)\b/i.test(lower))
    return { action: "block", reason: "adult", score: -100 };

  // One-off news, politics, celebrity, and entertainment trends
  if (/\b(trump|biden|election|president|minister|senator|congress|politics|palestine|iran|israel|epstein)\b/i.test(lower))
    return { action: "block", reason: "politics", score: -90 };
  if (/\b(celebrity|actor|singer|idol|movie|film|tv show|episode|season|cast|trailer|netflix|coachella|american idol)\b/i.test(lower))
    return { action: "block", reason: "entertainment", score: -90 };
  if (/\b(arrested|arrest|lawsuit|scandal|killed|shot|bleeding|poison|crime|dui|foul ball)\b/i.test(lower))
    return { action: "block", reason: "news_event", score: -90 };

  // Exams, answers, word games, and short-lived puzzle intent
  if (/\b(exam|result|answer key|answer|wordle|crossword|clue|hint|jamb|jee|cbse|dsssb|nta|bitsat|cutoff|reprint)\b/i.test(lower))
    return { action: "block", reason: "exam_or_puzzle", score: -90 };

  // Finance, trading, market, and commodity noise
  if (/\b(stock|stocks|equity|equities|futures|trading|forex|crypto|bitcoin|gold price|share price|dividend|ipo)\b/i.test(lower))
    return { action: "block", reason: "finance", score: -90 };

  // Sports, games, and transient event trackers
  if (/\b(pokemon|fifa|football|soccer|rugby|nba|nhl|pga|masters|marathon|champions|team builder|draft|league|leagues|score chart)\b/i.test(lower))
    return { action: "block", reason: "sports_or_game", score: -80 };
  if (/\b(chelsea|arsenal|liverpool|manchester united|man utd|manchester city|newcastle|barcelona|real madrid|tottenham|spurs)\b/i.test(lower))
    return { action: "block", reason: "sports_team", score: -90 };
  if (/\b(manager|coach|head coach)\b/i.test(lower) && /\b(sacked|rumor|rumors|next|new|replacement|hired|appointment|appointed)\b/i.test(lower))
    return { action: "block", reason: "sports_manager_news", score: -90 };
  if (/\b(cyclone|typhoon|ship tracker|marine traffic|tanker tracker|hurricane|weather tracker)\b/i.test(lower))
    return { action: "block", reason: "event_tracker", score: -80 };

  // Coupon, redeem, and code snippets that are not durable tool demand.
  if (/\b(coupon|promo code|redeem code|presale code|hsn code|area code)\b/i.test(lower))
    return { action: "block", reason: "coupon_or_code", score: -80 };

  // How-to / generic queries
  if (/^(how to|where to|what is|who is|why does|when does)\b/i.test(lower))
    return { action: "block", reason: "generic_query", score: -70 };

  // --- Demotions (action: demote, low score) ---

  // Entertainment (likely short-term)
  if (/\b(trailer|cast|episode|season|movie|film|tv series|anime|manga|novel|book|author|comic|celebrity|singer|actor)\b/i.test(lower))
    return { action: "demote", reason: "entertainment", score: -40 };

  // News events
  if (/\b(news|outage|incident|killed|shot|arrest|crime|scandal|lawsuit)\b/i.test(lower))
    return { action: "demote", reason: "news_event", score: -50 };

  // Finance (not tool-related)
  if (/\b(stock|invest|trading|crypto|bitcoin|forex|commodity|ipo|dividend)\b/i.test(lower))
    return { action: "demote", reason: "finance", score: -30 };

  // Medical
  if (/\b(symptom|disease|treatment|cure|medicine|hospital|doctor|diagnosis)\b/i.test(lower))
    return { action: "demote", reason: "medical", score: -30 };

  // --- Positive signals (high score) ---

  let score = 0;

  // Tool-indicating suffixes = persistent demand
  const toolPatterns = /\b(tool|tools|builder|generator|creator|maker|checker|converter|analyzer|calculator|finder|scanner|detector|solver|optimizer|editor|manager|planner|tracker|monitor|extractor|compressor|enhancer|remover|compressor)\b/i;
  if (toolPatterns.test(lower)) score += 40;

  // AI-related = strong trend signal
  const aiPatterns = /\b(ai|artificial intelligence|machine learning|deep learning|gpt|llm|neural|automation|copilot|agent|chatbot|claude|gemini|openai)\b/i;
  if (aiPatterns.test(lower)) score += 35;

  // SaaS/software patterns
  const saasPatterns = /\b(app|software|platform|service|extension|plugin|addon|api|sdk|integration|workflow|template|dashboard)\b/i;
  if (saasPatterns.test(lower)) score += 20;

  // Free/online patterns (search intent)
  if (/\b(free|online|no sign|without water|unlimited|best|top \d+)\b/i.test(lower)) score += 10;

  // Short compound words (2-3 words) are usually better than single words
  if (wordCount >= 2 && wordCount <= 4) score += 10;

  // Has both AI + tool = very strong
  if (toolPatterns.test(lower) && aiPatterns.test(lower)) score += 20;

  if (score > 30) {
    return { action: "keep", reason: "high_value", score };
  }

  if (score > 0) {
    return { action: "keep", reason: "moderate", score };
  }

  // Neutral - keep but low priority
  return { action: "demote", reason: "neutral", score: score - 10 };
}

/**
 * Batch score keywords. Returns keep list and block list.
 */
export function batchScoreKeywords(keywords: string[]): {
  kept: { keyword: string; score: number; reason: string }[];
  blocked: string[];
} {
  const kept: { keyword: string; score: number; reason: string }[] = [];
  const blocked: string[] = [];

  for (const kw of keywords) {
    const result = scoreKeyword(kw);
    if (result.action === "block") {
      blocked.push(kw);
    } else {
      kept.push({ keyword: kw, score: result.score, reason: result.reason });
    }
  }

  // Sort kept by score descending
  kept.sort((a, b) => b.score - a.score);
  return { kept, blocked };
}
