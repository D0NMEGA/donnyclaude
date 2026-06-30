#!/usr/bin/env browser-harness
# Reddit bulk scraper — runs INSIDE browser-harness (helpers pre-imported).
#
# ROUTING DECISION (REDDIT-01, Phase 14): this is the RESERVED, DELIBERATE manual fallback,
# NOT the routine-read path. The in-core official OAuth Data API source (research.reddit) is the
# sanctioned routine path (HTTP, subagent-safe). This scraper is out-of-core and NOT subagent-safe
# (browser-harness errors out in a Donny subagent), and it is a subreddit-listing deep-scrape — NOT
# a topic search. Use it only as a deliberate manual opt-in when the OAuth path is unavailable.
#
#   SUB=LocalLLaMA T=year MAX_POSTS=50 TOP_COMMENTS=8 \
#       browser-harness < ~/.claude/scrapers/reddit_scrape.py
#
# Fetches r/<SUB> <SORT> over time window <T>, plus the top comments of each
# post, into one JSON file. Uses the real Chrome (Reddit 403s server-side
# requests) so it needs a browser-harness connection (bh-chrome).
#
# Env knobs (all optional):
#   SUB           subreddit name           (default ClaudeAI)
#   SORT          top|hot|new|rising       (default top)
#   T             hour|day|week|month|year|all  (default month; only affects top/controversial)
#   MAX_POSTS     how many posts           (default 20)
#   TOP_COMMENTS  top comments per post     (default 5)
#   DELAY         seconds between fetches   (default 1.0, be polite)
#   OUT           output path               (default ~/.claude/scrapers/out/reddit_<SUB>_<SORT>_<T>.json)

import os, json, time

SUB          = os.environ.get("SUB", "ClaudeAI")
SORT         = os.environ.get("SORT", "top")
T            = os.environ.get("T", "month")
MAX_POSTS    = int(os.environ.get("MAX_POSTS", "20"))
TOP_COMMENTS = int(os.environ.get("TOP_COMMENTS", "5"))
DELAY        = float(os.environ.get("DELAY", "1.0"))
OUT          = os.environ.get("OUT", os.path.expanduser(
                   f"~/.claude/scrapers/out/reddit_{SUB}_{SORT}_{T}.json"))

_tab_open = {"v": False}

def bfetch(url, tries=3):
    """Fetch a Reddit .json endpoint through the real browser and parse it."""
    body = ""
    for i in range(tries):
        if not _tab_open["v"]:
            new_tab(url); _tab_open["v"] = True
        else:
            goto_url(url)
        wait_for_load(); wait(1.2 + i * 0.8)
        body = js("document.body.innerText")
        try:
            return json.loads(body)
        except Exception:
            time.sleep(2.0 + i * 2.0)   # gate / 429 / hydration — back off and retry
    raise RuntimeError(f"could not parse JSON from {url} (head={body[:80]!r})")

def collect_listing():
    posts, after = [], None
    while len(posts) < MAX_POSTS:
        limit = min(100, MAX_POSTS - len(posts))
        url = f"https://www.reddit.com/r/{SUB}/{SORT}/.json?t={T}&limit={limit}&raw_json=1"
        if after:
            url += f"&after={after}&count={len(posts)}"
        data = bfetch(url)
        kids = data.get("data", {}).get("children", [])
        if not kids:
            break
        posts += [c["data"] for c in kids if c.get("kind") == "t3"]
        after = data.get("data", {}).get("after")
        if not after:
            break
        time.sleep(DELAY)
    return posts[:MAX_POSTS]

def top_comments(permalink):
    url = f"https://www.reddit.com{permalink}.json?sort=top&limit={TOP_COMMENTS}&depth=1&raw_json=1"
    try:
        data = bfetch(url)
    except Exception:
        return []
    if not isinstance(data, list) or len(data) < 2:
        return []
    out = []
    for c in data[1].get("data", {}).get("children", []):
        if c.get("kind") != "t1":
            continue
        d = c["data"]
        out.append({
            "author":      d.get("author"),
            "score":       d.get("score"),
            "created_utc": d.get("created_utc"),
            "body":        (d.get("body") or "").strip(),
        })
        if len(out) >= TOP_COMMENTS:
            break
    return out

print(f"[reddit] r/{SUB} {SORT}/{T}  -> {MAX_POSTS} posts, top {TOP_COMMENTS} comments each")
raw = collect_listing()
print(f"[reddit] collected {len(raw)} posts; pulling comments...")

records = []
for i, p in enumerate(raw, 1):
    rec = {
        "id":           p.get("id"),
        "title":        p.get("title"),
        "author":       p.get("author"),
        "score":        p.get("score"),
        "upvote_ratio": p.get("upvote_ratio"),
        "num_comments": p.get("num_comments"),
        "created_utc":  p.get("created_utc"),
        "flair":        p.get("link_flair_text"),
        "permalink":    p.get("permalink"),
        "url":          p.get("url"),
        "is_self":      p.get("is_self"),
        "selftext":     (p.get("selftext") or "").strip(),
        "top_comments": top_comments(p.get("permalink")),
    }
    records.append(rec)
    print(f"  [{i}/{len(raw)}] {rec['score']:>6} pts | {len(rec['top_comments'])} cmts | {rec['title'][:58]}")
    time.sleep(DELAY)

result = {
    "source":       "reddit",
    "subreddit":    SUB,
    "sort":         SORT,
    "time":         T,
    "generated_utc": time.time(),
    "post_count":   len(records),
    "posts":        records,
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    json.dump(result, f, indent=2, ensure_ascii=False)
print(f"[reddit] wrote {len(records)} posts -> {OUT} ({os.path.getsize(OUT):,} bytes)")
