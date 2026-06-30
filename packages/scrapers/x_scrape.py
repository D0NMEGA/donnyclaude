#!/usr/bin/env browser-harness
# X / Twitter scraper — runs INSIDE browser-harness. X gates reading behind
# login, so this needs the browser-harness Chrome logged into X (do it once in
# ~/.browser-harness-profile; the session persists). Detects the login wall and
# reports cleanly if not authenticated.
#
#   MODE=search Q="AI agents" F=top  MAX_TWEETS=40 browser-harness < x_scrape.py
#   MODE=profile Q=karpathy           MAX_TWEETS=40 browser-harness < x_scrape.py
#
# Env: MODE(search|profile), Q(query or handle), F(top|live), MAX_TWEETS, OUT

import os, json, time, urllib.parse

MODE = os.environ.get("MODE", "search")
Q    = os.environ.get("Q", "AI agents")
F    = os.environ.get("F", "top")
MAX  = int(os.environ.get("MAX_TWEETS", "30"))
OUT  = os.environ.get("OUT", os.path.expanduser(
           f"~/.claude/scrapers/out/x_{MODE}_{Q.replace(' ', '_')[:30]}.json"))

if MODE == "profile":
    url = f"https://x.com/{Q.lstrip('@')}"
else:
    url = f"https://x.com/search?q={urllib.parse.quote(Q)}&src=typed_query&f={F}"

new_tab(url); wait_for_load(); wait(3.0)

state = js(r"""
(()=>({
  login: /\/i\/flow\/login|\/login|\/i\/flow/.test(location.href)
         || !!document.querySelector('[data-testid="loginButton"], a[href="/login"]'),
  tweets: document.querySelectorAll('article[data-testid="tweet"]').length,
  href: location.href
}))()
""")
print("[x] state:", state)

EXTRACT = r"""
(()=>{
  const out=[];
  for(const art of document.querySelectorAll('article[data-testid="tweet"]')){
    const textEl=art.querySelector('[data-testid="tweetText"]');
    const text=textEl?textEl.innerText:'';
    const nameEl=art.querySelector('[data-testid="User-Name"]');
    const nameTxt=nameEl?nameEl.innerText.replace(/\n/g,' '):'';
    const handle=(nameTxt.match(/@\w+/)||[''])[0];
    const timeEl=art.querySelector('time');
    const ts=timeEl?timeEl.getAttribute('datetime'):'';
    const linkEl=timeEl?timeEl.closest('a'):null;
    const u=linkEl?linkEl.href:'';
    const metric=(tid)=>{const e=art.querySelector('[data-testid="'+tid+'"]');
      if(!e)return null;const a=e.getAttribute('aria-label')||'';
      const m=a.match(/([\d,.]+)/);return m?m[1]:'0';};
    out.push({text, name:nameTxt, handle, ts, url:u,
      replies:metric('reply'), reposts:metric('retweet'), likes:metric('like')});
  }
  return out;
})()
"""

seen, tweets = set(), []
if not state.get("login"):
    for _ in range(40):
        for t in js(EXTRACT):
            key = t.get("url") or (t.get("handle", "") + t.get("text", "")[:40])
            if key in seen or not t.get("text"):
                continue
            seen.add(key); tweets.append(t)
        if len(tweets) >= MAX:
            break
        scroll(600, 400, dy=2200); wait(1.5)

tweets = tweets[:MAX]
result = {"source": "x", "mode": MODE, "query": Q, "filter": F,
          "generated_utc": time.time(), "count": len(tweets), "items": tweets,
          "note": ("NOT LOGGED IN — log into X once in ~/.browser-harness-profile "
                   "(run bh-chrome, open x.com, sign in). Session persists.")
                  if state.get("login") or not tweets else ""}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    json.dump(result, f, indent=2, ensure_ascii=False)
print(f"[x] wrote {len(tweets)} tweets -> {OUT}"
      + ("  (LOGIN REQUIRED)" if result["note"] else ""))
