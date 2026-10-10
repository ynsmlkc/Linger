# Linger — Stitch brief'i

Google Stitch'e yapıştırılacak metinler aşağıda. Stitch İngilizce'de belirgin şekilde daha iyi çalışıyor, bu yüzden yapıştırılacak bölümler İngilizce; bu satırlar ve "Geliştirici notları" Türkçe.

**Nasıl kullan:** Önce **§1 Master prompt**'u yapıştır (stil + kısıtlar). Sonra ekranları tek tek, **§2'deki prompt'larla** iste. Stitch tek seferde çok uzun prompt'ta ekranları karıştırıyor; ekran başına bir prompt daha iyi sonuç verir. Ürettiği ekranı beğenmezsen §3'teki "düzeltme cümleleri"ni kullan.

Yapıştırma dışında kalanlar (§4–§5) senin için: API şekilleri ve tasarımın koda dönüşürken uyulacak kurallar.

---

## 1. Master prompt (ilk bunu yapıştır)

```
Design a small web product called "Linger". Desktop-first, but every screen
must also work at 360px width.

WHAT IT IS
Linger is a terminal-native ad marketplace. Developers who use an AI coding
assistant install a tiny command-line tool. While they wait for the assistant
to answer, ONE line of sponsored plain text appears in the status line at the
bottom of their terminal. When the answer arrives, the line disappears.
Developers are paid in USDC on the Solana blockchain. Advertisers are small
developer-tool companies who pay to have their line shown.

The entire product is one line of monospace text. Design around it. A real one:

  ✶ Firecrawl — docs to LLM-ready markdown · firecrawl.dev

It is currently on Solana DEVNET (test money). Say so plainly in the UI with a
small "devnet" label. Do not hide it and do not apologise for it.

AUDIENCE
1) Developers: skeptical, allergic to marketing language, read the privacy
   section first. Write for someone who will `cat` a script before running it.
2) Advertisers: small dev-tool companies. They want to see what the placement
   looks like and what it costs. No funnels.

IDENTITY
There is NO email, NO password, NO signup form anywhere. You sign in by
connecting a Solana wallet (Phantom, Solflare or Backpack) and signing a short
text message. That message is not a transaction and costs nothing. The same
person can be both a publisher (developer) and an advertiser, as two separate
logins.

THE ONE COMPONENT THAT MATTERS: "Ad preview"
Render the ad exactly as it appears in a terminal: dark ground, monospace,
real spacing. The "✶" glyph in the accent color, brand in bold, the message,
then the domain dimmed. On the right, dimmed and right-aligned, show what the
assistant is doing at that moment, e.g. "Edit · 2.8s", "Search · 12.4s",
"Thinking · 41.0s". Support two states: "waiting" (ad + activity) and "idle"
(the ad is gone, only the activity remains). No logo slot, no rounded ad
line, no gradient on the line itself — it is plain text in a terminal.

VISUAL DIRECTION
Restraint is the brand: a line of text that appears in the dark, does its job
and disappears. Anything loud contradicts what is being sold.
- Monospace carries more of the page than usual: data, labels, commands,
  wallet addresses, amounts, every ad preview. Pair it with ONE well-set text
  typeface for prose and headlines. Do NOT use Inter or Space Grotesk.
- Accent color: the warm orange of the "✶" glyph. Bias the neutrals slightly
  toward that hue instead of pure grey. Dark theme first; also provide light.
- Tabular figures wherever amounts align in columns.

DO NOT PRODUCE
purple-to-blue gradient hero; three feature cards with circular pastel icons;
bento grids; glassmorphism; big blurred gradient blobs; tilted floating
dashboard screenshots; fake logo walls, fake testimonials, fake avatars;
invented stats or earnings figures; animated counters; emoji as section
markers; everything centered; stock illustrations.

ALSO
- Every button and link has a real action. If a feature does not exist, there
  is no button for it.
- Money is shown to full precision (e.g. $0.575, never rounded to $0.58).
- All copy in English. Realistic content, no lorem ipsum.
```

---

## 2. Ekran prompt'ları (her biri ayrı)

### 2.1 Landing `/`

```
Design the landing page for developers.

Sections, in order:
1. Hero — one concrete headline sentence (not "monetize your workflow").
   The ad line inside a realistic terminal frame with a prompt line above it;
   this is the most important element on the page. It appears when "waiting"
   starts, rotates every few seconds between examples (Firecrawl, Resend,
   Neon), and disappears when the "answer" arrives. Primary CTA is a copy field
   with `npx lingersh init` (clicking copies; label becomes "Copied" for 2s).
   Secondary link: "How it works".
2. The honest line — one short paragraph under the hero: it only shows while
   you wait, it vanishes when the answer arrives, it never interrupts, nothing
   shows when you are idle.
3. How it works, 3 steps: Install (one command, edits only your assistant's
   settings) → Wait (the line shows while the model works) → Get paid (USDC to
   your Solana wallet; you connect it, we never see your keys). Do NOT use three
   identical rounded cards with circle icons — use a numbered horizontal
   sequence, a diagram or a table instead.
4. What we send vs. never send — a two-column table.
   Send: impression id, campaign id, duration, session id, client version, OS
   and architecture. Never send: your directory path, file names, prompts,
   code. Link "Read the full privacy page".
5. Where this stands — "Solana devnet. Advertisers deposit, publishers get
   paid on-chain, the pipeline runs end to end with test money." A small mono
   panel: network devnet · asset USDC · publisher share 50%. A placeholder
   line where a real payout transaction link will go.
6. Uninstall — short: `linger uninstall` removes only our own entries.
7. Advertiser strip — one line and a button "For advertisers".
8. Footer — GitHub, Privacy, "devnet". Nothing else.

Do NOT include: logo wall, testimonials, pricing tiers, invented stats, blog
teaser, roadmap, FAQ accordion.
```

### 2.2 Yayıncı paneli `/app` — bağlanmamış + boş durum

```
Design the publisher dashboard, two screens.

Screen A — not connected: one centered card. One sentence: connect the wallet
where you want to be paid. Button "Connect wallet". Under it, a small note:
"You sign a message to prove the address is yours. It cannot be submitted to
the network and it moves nothing. Your private key never leaves your wallet."
Show the login as three visible states: "Looking for your wallet…",
"Sign the message in Phantom…", and an error state that shows the message in
full with a "Try again" button. If no Solana wallet is detected, replace the
button with an inline message and install links for Phantom, Solflare and
Backpack — never a dead disabled button.

Screen B — connected, no earnings yet: the wallet address shown IN FULL (never
truncated; the user must be able to verify where their money goes) with a copy
button, a calm empty state "No impressions yet.", the install command
`npx lingersh init` with a copy button, and one line: it can take a few
minutes after your first session.
```

### 2.3 Yayıncı paneli — veri durumu

```
Design the publisher dashboard with data. Four numbers, but NOT four identical
stat cards — give "Payable" visual primacy.

- Payable   $0.575   verified, yours
- Pending   $0.32    counted, not verified yet — may not survive
- In flight $0.07    sent to the chain, awaiting confirmation (hide this row
                     completely when zero)
- Lifetime  $0.575   total ever earned (secondary)

Below the numbers:
- Progress to payout: a bar from $0 to the $1.00 threshold with the remainder
  in words ("$0.425 to go"). At the threshold it becomes "Threshold reached —
  included in the next payout round."
- An informational row (not an error) that explains why a payout has not
  happened, when there is a reason: e.g. "Address changed — payouts resume in
  47 hours" or "Your USDC account is frozen by the issuer".
- Wallet: full address, copy button, link "View on Solana Explorer". Small
  text: to change your payout wallet run `linger login --force`. No
  wallet-change button.
- A line: "Your USDC account is created automatically on your first payout —
  you don't need to do anything."
- Withdraw: a button that reveals an inline amount field (available amount
  shown, minimum $0.10), then a success state with a link to the transaction.
- Recent payouts table: date, amount, status, transaction (links to Solana
  Explorer). Empty → a one-line empty state, not a skeleton.

Also design: loading, network error with Retry, and "session expired —
reconnect wallet".
Amounts have up to 6 decimals; show raw micro-units on hover.
```

### 2.4 Reklamveren tanıtım `/advertisers`

```
Design a page (not a funnel) for advertisers. Sections:
- What the placement is, with the same real ad line as the landing hero.
- Who sees it: developers, at the moment they are idle waiting for a model.
- Format constraints, plainly: one line, plain text, at most 80 characters
  including brand and domain. No images, no animation, no tracking pixels.
- What counts: only impressions displayed longer than 10 seconds.
- What it costs: you set a CPM, minimum $0.10 per 1,000 impressions.
  Publishers receive 50%. No pricing table.
- Call to action: "Connect wallet to start".
No contact form — it is self-serve.
```

### 2.5 Reklamveren paneli `/advertisers/app` — para yatırma

```
Design the advertiser dashboard, first screens.

Screen A — not connected: same login card as the publisher side, different
copy: connect the wallet you will fund campaigns from. The wallet matters.

Screen B — connected, zero balance: the deposit instructions ARE the whole
screen; nothing competes with them.
- The deposit address in full with a copy button and a QR code.
- Asset: USDC on Solana devnet, with the token mint address in small mono text.
- The critical warning, impossible to miss: payments are matched by SENDER
  ADDRESS. Only USDC sent from your own connected wallet is credited. Money
  sent from an exchange arrives but cannot be matched to you.
- After sending: "credited within about 30 seconds" with a "checking…"
  indicator that flips to a success state when the balance changes.
```

### 2.6 Reklamveren paneli — kampanyalar

```
Design the funded advertiser dashboard.

Balance block: the balance as the headline number. A second "spendable"
number ONLY when it differs from the balance, with one line explaining the
difference (the rest is reserved for ads already delivered but not yet
reported). An "Add funds" action that reopens the deposit instructions.
Add a "Withdraw unspent balance" action with an inline amount field.

Campaign list — each row's visual anchor is the ad preview component. Also
show: status (paused / active / exhausted), CPM formatted as USD ("$40.00
CPM") with cost per impression underneath ("$0.04"), and a toggle Activate /
Pause. If activation is refused for lack of budget, show an inline message
"No budget — add funds" (no modal). There is NO delete and NO edit — do not
draw those buttons.

New campaign form, fields: brand, text, cta (domain), CPM in dollars.
- LIVE preview that renders exactly "✶ {brand} — {text} · {cta}".
- A live character counter for the WHOLE line against 80; turns red past 80.
- cta must be a bare domain — reject https://, paths and query strings, and
  explain why (the developer must land where the line says they will).
- CPM at least $0.10 per 1,000. Show the publisher's 50% share as a note, not
  an input — it is fixed.
- Per-field server errors: highlight the input and show a hint beneath it.
- After creating: the campaign appears PAUSED, with one line explaining why —
  you review it, then start it; a typo shown to thousands of people cannot be
  undone and has already been paid for.
- A "Download image" action on the preview that exports the line as a PNG.
Design every state: loading, network error, session expired, no campaigns,
paused, active, line-too-long while typing.
```

### 2.7 Gizlilik `/privacy`

```
Design a plain-prose privacy page, not legal boilerplate:
- The exact list of fields sent to the server.
- The project identifier is hashed with a salt that never leaves the machine;
  raw paths never reach the network.
- IP addresses are hashed, never stored raw.
- The wallet private key never enters the command-line tool or the site.
  Sign-in is a message signature handled by your wallet extension; the
  message is plain text, not a transaction, so it can never move anything.
- Removal: `linger uninstall`.
```

---

## 3. Düzeltme cümleleri (Stitch'in ürettiği şeyi yönlendirmek için)

- "Remove the three identical cards; use one numbered horizontal sequence instead."
- "Make the terminal ad line the largest visual element on the screen."
- "Use monospace for every amount, address and command. Keep one text typeface for prose only."
- "Show the wallet address in full, not truncated."
- "Remove any button that does not have a real action described in the brief."
- "Replace the blue/purple gradient with the warm orange accent on a warm near-black background."
- "Remove all invented statistics and testimonials."
- "Show the character counter against the whole composed line, not the single field."

---

## 4. Geliştirici notları (Stitch'e yapıştırma)

### Ekranlar ↔ rotalar

| Rota | Amaç | Cüzdan gerekir mi |
|---|---|---|
| `/` | landing | hayır |
| `/app` | yayıncı paneli | evet (`publisher`) |
| `/advertisers` | reklamveren tanıtımı | hayır |
| `/advertisers/app` | reklamveren paneli | evet (`advertiser`) |
| `/privacy` | gizlilik | hayır |

### API (şu an gerçekten var olanlar)

```
GET  /health
GET  /v1/config

POST /v1/auth/challenge   { address }
                          → { message, expiresAt }
POST /v1/auth/verify      { address, message, signature /* base64 */, role? }
                          → { token, tokenId, publisherId, role }
                            role: "publisher" (varsayılan) | "advertiser"

GET  /v1/me/balance                               (yayıncı)
POST /v1/publisher/withdraw   { amountMicros }        (yayıncı)

GET  /v1/advertiser/me                             (reklamveren)
POST /v1/advertiser/campaigns             { brand, text, cta, bidCpmMicros }
POST /v1/advertiser/campaigns/:id/status  { status: "active" | "paused" }
POST /v1/advertiser/withdraw               { amountMicros }
```

`/v1/me/balance` örneği:

```json
{
  "pendingMicros": "320000",
  "payableMicros": "575000",
  "inFlightMicros": "0",
  "lifetimeMicros": "575000",
  "withdrawableMicros": "575000",
  "payoutThresholdMicros": "1000000",
  "recentPayouts": [],
  "blockedReason": "threshold 1000000 micro, balance 575000"
}
```

`/v1/advertiser/me` örneği:

```json
{
  "advertiserId": "<cüzdan adresi>",
  "balanceMicros": "20000000",
  "spendableMicros": "18400000",
  "deposit": {
    "address": "<hazine cüzdan adresi>",
    "asset": "USDC",
    "network": "devnet",
    "usdcMint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    "note": "Yalnizca <kendi adresin> adresinden gonderilen odemeler hesabina yazilir"
  },
  "campaigns": [
    {
      "id": "c-01M07QTJMKWEK07FCT7EFJMYD2",
      "brand": "Resend",
      "text": "email API for developers",
      "cta": "resend.com",
      "bidCpmMicros": "40000000",
      "status": "active",
      "preview": "✶ Resend — email API for developers · resend.com"
    }
  ]
}
```

**Para birimi:** `micro` = USDC'nin milyonda biri (6 hane; USDC mint'iyle aynı). `40000000` = **$40 CPM** = gösterim başına $0,04. `575000` = **$0,575** (yuvarlama yok). Ayrıştırma `BigInt` ile; `parseFloat` yok. `packages/server/public/app.js` içindeki `usd()` ve `toMicros()` bunu zaten doğru yapıyor — yeni arayüz onları kullanmalı.

### Doğrulama kuralları (formda gösterilmeli)

| Kural | Değer |
|---|---|
| Satır uzunluğu | `✶ {brand} — {text} · {cta}` **≤ 80 karakter** |
| `cta` | yalnızca alan adı: `firecrawl.dev` ✓, `https://x.com/a` ✗ |
| Kaçış / kontrol karakteri | reddedilir (temizlenmez) |
| Minimum teklif | 100.000 micro CPM = **$0,10 / 1000** |
| Yayıncı payı | **%50, sabit** |
| Yeni kampanya | **`paused` başlar** |
| Bakiyesiz yayına alma | **402** |
| Minimum çekim | 100.000 micro = **$0,10** |
| Ödeme eşiği | 1.000.000 micro = **$1** |

Hata cevabı bozuk alanı söyler: `{ "code": "LNG_9001", "message": "...", "hint": "...", "field": "text" }` → o input vurgulanır, `hint` altında gösterilir.

### Var OLMAYANLAR (tasarıma ekleme)

Cüzdan değiştirme ucu · cihaz/oturum iptali · kampanya silme/düzenleme · günlük bütçe, hedefleme, zamanlama, A/B · grafik ve istatistik (gösterim, tıklama, CTR yok) · e-posta/şifre girişi.

### Solana'ya özgü davranışlar (eski sürümden farklar)

- **"USDC kabul izni" ekranı YOK.** Yayıncının USDC hesabını ilk ödemede biz açıyoruz. Panelde yalnızca bilgilendirme satırı var.
- **Ücret / SOL uyarısı YOK** (yayıncı SOL'suz alabilir).
- Yayıncıyı engelleyebilecek durumlar `blockedReason` ile gelir: eşik altı, adres değişikliği bekleme süresi, dondurulmuş USDC hesabı, cüzdan bağlı değil.
- Reklamveren parası **gönderen adrese** göre eşleşir; borsadan gönderilen para eşleşmez — uyarı zorunlu.
- Adres `base58`, 32–44 karakter. Gizli anahtar / seed yapıştırılırsa sunucu reddeder; arayüz bu alanı hiçbir yere yazdırmaz/loglamaz.
- Ağ etiketi: **devnet**. Ana ağa geçince `app.js` içindeki `NETWORK` sabiti değişir (Explorer linkleri ona göre üretilir).

### Tasarım koda dönerken kurallar

- `packages/server/public/` altındaki sayfalar derleme adımsız, çerçevesiz. Stitch çıktısı düz HTML/CSS ise doğrudan bu klasöre; React ise ayrı bir paket açılır ve sunucu statik dosya olarak servis eder.
- Cüzdan bağlama, imza ve API çağrıları `public/app.js`'te: `login(role, onStep)`, `walletReady()`, `api()`, `session`, `usd()`, `toMicros()`, `explorer`. Bu dosyanın davranışı değişmeden kalmalı.
- Sunucu CSP'si sıkı: dış font CDN'i yok, dış script yok. Yazı tipleri dosya olarak servis edilir.
- Görsel indirme (PNG) tamamen istemci tarafında `<canvas>` ile.
- Yeni ekranlar bittiğinde `ROADMAP.md` M5 çıkış kriterleri işaretlenir.
