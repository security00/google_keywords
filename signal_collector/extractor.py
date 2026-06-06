"""Keyword extraction from signal items — simple per-title strategy.

Every title produces 0-2 keyword candidates (its best bigrams).
No cross-item merging (items are naturally unique).
DataForSEO volume is the ultimate noise filter.
"""

import logging
import re
import unicodedata
from typing import Dict, List, Set, Tuple

from .models import SignalItem, KeywordCandidate

logger = logging.getLogger(__name__)

STOP_WORDS: Set[str] = {
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "up", "about", "into", "over", "after",
    "is", "are", "was", "were", "be", "been", "being", "have", "has",
    "had", "do", "does", "did", "will", "would", "could", "should",
    "may", "might", "shall", "can", "need", "dare", "ought", "used",
    "it", "its", "i", "we", "you", "he", "she", "they", "this", "that",
    "these", "those", "my", "your", "his", "her", "its", "our", "their",
    "me", "us", "him", "her", "them", "some", "any", "no", "not", "none",
    "each", "every", "all", "both", "few", "more", "most", "other",
    "what", "which", "who", "whom", "where", "when", "why", "how",
    "get", "got", "getting", "make", "made", "making", "use", "used",
    "using", "like", "just", "also", "very", "really", "much", "many",
    "new", "good", "great", "best", "top", "big", "small", "high", "low",
    "one", "two", "first", "last", "next", "previous",
    "vs", "versus", "via", "de", "la", "le", "el", "du",
    "ask", "show", "tell", "need", "want", "looking", "trying",
    "help", "please", "anyone", "someone", "everyone",
    "ive", "youre", "theyre", "its",
    "able", "always", "another", "anything", "around",
    "back", "because", "before", "between", "come", "comes",
    "could", "did", "doing", "done", "down", "else",
    "even", "ever", "everything", "few", "finally",
    "go", "going", "gone", "got", "gotten",
    "having", "here", "however",
    "keep", "keeps", "kept",
    "later", "least", "less", "let", "lets",
    "long", "look", "looking", "looks",
    "may", "maybe", "mean", "means",
    "might", "more", "most", "must",
    "never", "next", "nor", "nothing", "now", "off", "often",
    "once", "only", "other", "others", "out", "over",
    "own", "per", "put", "puts", "quite", "rather",
    "right", "said", "same", "say", "says", "seen", "several",
    "side", "since", "still", "such", "sure",
    "take", "taken", "takes",
    "than", "their", "them", "then", "there", "these", "they",
    "thing", "things", "think", "thinks",
    "those", "though", "three", "through", "thus", "today",
    "together", "told", "too", "took", "try", "trying", "turn",
    "two", "under", "until", "upon",
    "usually", "various",
    "want", "wants", "was", "way", "ways", "well", "went", "were",
    "whether", "while", "who", "whole", "whose",
    "within", "without", "won",
    "yes", "yet", "us", "ve", "re",
    "called", "known", "based",
    "running", "working", "building", "creating",
    "using", "used", "uses", "making", "getting",
    "dont", "doesnt", "wont", "cant", "isnt", "wasnt", "arent",
    "werent", "havent", "hasnt", "hadnt", "couldnt", "wouldnt",
    "shouldnt", "mightnt", "mustnt",
}

GENERIC_WORDS: Set[str] = {
    "website", "websites", "app", "apps", "tool", "tools", "software",
    "platform", "service", "services", "product", "products",
    "resource", "resources", "guide", "guides", "tutorial", "tutorials",
    "review", "reviews", "list", "lists", "top", "best",
    "alternative", "alternatives", "solution", "solutions",
    "startup", "startups", "business", "online", "free", "paid",
    "beginner", "advanced", "simple", "easy", "fast", "quick",
    "developer", "developers", "user", "users", "customer", "customers",
    "client", "clients", "team", "teams", "project", "projects",
    "strategy", "strategies", "result", "results", "example", "examples",
    "version", "update", "updates", "feature", "features",
    "support", "help", "faq", "tips", "tricks", "hacks",
    "experience", "experiences", "problem", "problems", "question",
    "answer", "answers", "discussion", "discussions",
}

# Short brand/tech words that ARE good keyword components
BRAND_WORDS: Set[str] = {
    "gmail", "seo", "serp", "cpc", "ctr", "da", "saas", "api", "sdk",
    "cli", "ui", "ux", "ai", "ml", "llm", "db", "css", "svg", "pdf",
    "aws", "gcp", "seo", "serp", "cpc",
}

SINGLE_WORD_MIN_CHARS = 3


def _is_content_word(w: str) -> bool:
    """Check if a word is a 'content word' (noun/verb/adj that carries meaning)."""
    wl = w.lower()
    if wl in BRAND_WORDS:
        return True
    return len(wl) >= SINGLE_WORD_MIN_CHARS and wl not in STOP_WORDS and wl not in GENERIC_WORDS


def normalize_keyword(kw: str) -> str:
    kw = kw.lower().strip()
    kw = unicodedata.normalize("NFKD", kw)
    kw = re.sub(r"[^a-z0-9\s\-/#@]", " ", kw)
    kw = re.sub(r"\s+", " ", kw).strip()
    return kw


def _extract_best_bigrams(title: str) -> List[Tuple[str, str, float]]:
    """Extract the top bigrams from a title, scored by keyword quality."""
    clean = re.sub(r"[^\w\s\-/#@'—–]", " ", title)
    clean = re.sub(r"\s+", " ", clean).strip()
    words = clean.split()

    if len(words) < 2:
        return []

    scored: List[Tuple[str, str, float]] = []

    for i in range(len(words) - 1):
        w1, w2 = words[i], words[i + 1]
        if len(w1) < 2 or len(w2) < 2:
            continue

        # Both must be content words
        if not (_is_content_word(w1) and _is_content_word(w2)):
            continue

        bigram = f"{w1} {w2}"
        if len(bigram) < 6 or len(bigram) > 55:
            continue

        norm = normalize_keyword(bigram)
        if not norm:
            continue

        # Skip if both words are hyphenated fragments
        if len(norm.replace("-", "").replace("/", "")) < 5:
            continue

        # Score: presence of proper nouns (Uppercase), brand words, total length
        score = 20.0
        lowers = [w1.lower(), w2.lower()]

        # Bonus for brand words
        for w in lowers:
            if w in BRAND_WORDS:
                score += 30

        # Bonus for proper nouns (capitalized and > 2 chars)
        for w in [w1, w2]:
            if w[0].isupper() and len(w) > 2:
                score += 10
            # Bonus for long words (> 6 chars)
            if len(w) >= 6:
                score += 5

        scored.append((norm, bigram, score))

    # Sort by quality, take top 2
    scored.sort(key=lambda x: x[2], reverse=True)
    return scored[:2]


def extract_keyword_candidates(items: List[SignalItem]) -> List[KeywordCandidate]:
    """Extract keyword candidates from signal items.

    Per-item: extract best bigram(s), score independently.
    No cross-item merging.
    """
    candidates: List[KeywordCandidate] = []

    for item in items:
        title = item.title.strip()
        if len(title) < 10:
            continue

        bigrams = _extract_best_bigrams(title)
        if not bigrams:
            continue

        # Each bigram becomes its own candidate
        for norm, raw_bigram, quality in bigrams:
            candidate = KeywordCandidate(
                keyword=raw_bigram,
                keyword_normalized=norm,
                source_signals=[item],
                source_count=1,
                avg_hotness=item.hotness,
                first_seen_at=item.published_at,
                last_seen_at=item.published_at,
                extract_method="bigram",
            )
            candidates.append(candidate)

    # Sort by: hotness + quality
    def score(c: KeywordCandidate) -> float:
        return c.avg_hotness + (
            20 if any(s.provider.value == "hackernews" for s in c.source_signals) else 0
        )

    candidates.sort(key=score, reverse=True)

    logger.info("Extracted %d keyword candidates from %d items",
                len(candidates), len(items))
    return candidates


def _is_noise(norm: str, words: List[str]) -> bool:
    if len(norm) < 5:
        return True
    if re.match(r"^[\d\-\s]+$", norm):
        return True
    meaningful = [w for w in words if _is_content_word(w)]
    return not meaningful


extract_keywords_from_items = extract_keyword_candidates
