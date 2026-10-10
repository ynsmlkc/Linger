/**
 * `linger login` sirasinda tarayicida acilan sayfa.
 *
 * Neden tarayici? Cunku ozel anahtari GORMEK ISTEMIYORUZ (ADR-014). Phantom,
 * Solflare ve Backpack tarayici eklentileri; imzayi onlar atar, biz yalnizca
 * imzalanmis mesaji aliriz. Terminalden "gizli anahtarini yapistir" demek en
 * kolay yol olurdu ve en kotu karar olurdu.
 *
 * Sayfa 127.0.0.1'de, tek kullanimlik bir portta servis edilir. Disaridan
 * erisilemez; challenge/verify cagrilarini yerel surec disariya proxy'ler —
 * boylece CSP `connect-src 'self'` kalabiliyor ve sayfa baska hicbir yere
 * baglanamiyor.
 */

import { COUNTRY_CODES } from '@linger/protocol'

export interface LoginPageOpts {
  readonly nonce: string
  readonly port: number
  /** Siralama adimindaki "sitede gor" baglantisi icin. */
  readonly serverUrl?: string
}

/** Sayfaya gomulen ulke kodlari; adlari tarayici `Intl.DisplayNames` ile uretir. */
const CODES = JSON.stringify([...COUNTRY_CODES].sort())

export function loginPage(opts: LoginPageOpts): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Linger — connect your wallet</title>
<style>
  *, *::before, *::after { box-sizing: border-box }
  :root {
    --bg:#0c0b0a; --deep:#080706; --ink:#ece7e1; --soft:#d6d0c8;
    --muted:#9d968d; --faint:#6f6a63; --line:rgba(236,231,225,0.09);
    --line2:rgba(236,231,225,0.14); --accent:#f97335; --err:#b8574a; --ok:#8fae7f;
    --serif:'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif;
    --mono:ui-monospace,'SF Mono',SFMono-Regular,Menlo,Consolas,monospace;
  }
  body {
    margin:0; min-height:100vh; display:grid; grid-template-rows:auto 1fr auto;
    font-family:var(--serif); background:var(--bg); color:var(--ink);
    -webkit-font-smoothing:antialiased; font-variant-numeric:tabular-nums;
    background-image:
      linear-gradient(rgba(236,231,225,0.032) 1px, transparent 1px),
      linear-gradient(90deg, rgba(236,231,225,0.032) 1px, transparent 1px);
    background-size:64px 64px;
  }
  a { color:var(--ink); text-decoration:none }
  a:hover { color:var(--accent) }
  :focus-visible { outline:2px solid var(--accent); outline-offset:3px }
  ::selection { background:rgba(249,115,53,0.3) }

  header, footer {
    display:flex; align-items:center; justify-content:space-between;
    gap:10px 24px; flex-wrap:wrap; padding:14px clamp(16px,4vw,40px);
    font-family:var(--mono); font-size:12.5px; color:var(--faint);
  }
  header { border-bottom:1px solid var(--line) }
  footer { border-top:1px solid var(--line) }
  .brand { display:flex; align-items:baseline; gap:9px; font-size:14px; color:var(--ink) }
  .brand i { color:var(--accent); font-size:15px; font-style:normal }
  .chip {
    display:inline-flex; align-items:center; gap:8px; padding:5px 11px;
    border:1px solid rgba(236,231,225,0.16); border-radius:3px;
    font-size:12px; color:var(--muted); white-space:nowrap;
  }
  .chip i { width:5px; height:5px; border-radius:50%; background:var(--accent); display:block }

  main { display:grid; place-items:center; padding:clamp(28px,6vw,72px) clamp(16px,4vw,40px) }
  .card { width:100%; max-width:620px; display:grid; gap:22px }

  .eyebrow { margin:0; font-family:var(--mono); font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:var(--accent) }
  h1 { margin:0; font-weight:400; font-size:clamp(30px,4.4vw,44px); line-height:1.08; letter-spacing:-.02em; text-wrap:pretty }
  .lede { margin:0; max-width:52ch; font-family:var(--mono); font-size:14px; line-height:1.7; color:var(--muted); text-wrap:pretty }
  .lede b { color:var(--soft); font-weight:400 }

  .term { border:1px solid var(--line2); border-radius:6px; background:var(--deep); overflow:hidden }
  .term-bar {
    display:flex; align-items:center; justify-content:space-between; gap:12px;
    padding:10px 14px; border-bottom:1px solid rgba(236,231,225,0.1);
    font-family:var(--mono); font-size:12px; color:var(--faint);
  }
  .log { padding:18px 16px; font-family:var(--mono); font-size:13.5px; line-height:1.9; display:grid; gap:2px }
  .log div { white-space:pre-wrap; word-break:break-all }
  @keyframes blink { 0%,49%{opacity:1} 50%,100%{opacity:.15} }
  .caret { animation:blink 1.1s steps(1) infinite }

  .addr {
    border-top:1px solid rgba(236,231,225,0.1); background:rgba(249,115,53,0.05);
    padding:16px; display:grid; gap:10px; font-family:var(--mono); font-size:13px;
  }
  .addr .k { color:var(--faint); font-size:12px; letter-spacing:.1em; text-transform:uppercase }
  .addr .v { color:var(--ink); word-break:break-all; line-height:1.6 }
  .facts { display:flex; flex-wrap:wrap; gap:8px 22px; color:var(--faint) }
  .facts span { white-space:nowrap }
  .facts em { font-style:normal; color:var(--ink) }

  button {
    font-family:var(--mono); cursor:pointer;
    border:1px solid rgba(236,231,225,0.2); border-radius:4px;
    background:transparent; color:var(--ink);
  }
  button:disabled { cursor:default }
  .primary {
    width:100%; display:flex; align-items:center; justify-content:center; gap:12px;
    padding:15px 20px; font-size:14.5px; background:var(--accent);
    border-color:var(--accent); color:var(--bg);
  }
  .primary:hover:not(:disabled) { filter:brightness(1.08) }
  .primary:disabled { cursor:progress }
  .primary.quiet { background:transparent; border-color:rgba(236,231,225,0.2); color:var(--ink) }
  .linkish {
    padding:0; border:0; background:none; color:var(--muted);
    font-size:13px; border-bottom:1px solid rgba(236,231,225,0.2);
  }
  .linkish:hover { color:var(--ink) }

  .manual { border:1px solid var(--line2); border-radius:6px; padding:16px; display:grid; gap:12px; background:rgba(236,231,225,0.02) }
  .manual p { margin:0; font-family:var(--mono); font-size:13px; line-height:1.7; color:var(--muted) }
  .manual code { font-family:var(--mono); font-size:12px; color:var(--faint); word-break:break-all; line-height:1.6 }
  .manual input, .manual textarea {
    width:100%; padding:11px 12px; border:1px solid rgba(236,231,225,0.18); border-radius:4px;
    background:var(--deep); color:var(--ink); font-family:var(--mono); font-size:13px; line-height:1.6; resize:vertical;
  }

  ul.notes { margin:0; padding:14px 0 0; border-top:1px solid var(--line); list-style:none; display:grid; gap:9px; font-family:var(--mono); font-size:12.5px; color:var(--faint) }
  ul.notes li { display:grid; grid-template-columns:14px 1fr; gap:10px }
  ul.notes li i { color:var(--accent); font-style:normal }
  ul.notes li span { line-height:1.6; text-wrap:pretty }

  .manual select {
    width:100%; padding:11px 12px; border:1px solid rgba(236,231,225,0.18); border-radius:4px;
    background:var(--deep); color:var(--ink); font-family:var(--mono); font-size:13px;
  }
  .manual label.check { display:flex; align-items:center; gap:10px; font-family:var(--mono); font-size:13px; color:var(--soft); cursor:pointer }
  .manual label.check input { width:auto; accent-color:var(--accent) }
  .pbtns { display:flex; flex-wrap:wrap; gap:12px 18px; align-items:center }
  .pbtns .primary { width:auto; padding:11px 18px; font-size:13.5px }

  .hide { display:none !important }
  @media (prefers-reduced-motion: reduce) { .caret { animation:none } }
</style></head>
<body>

<header>
  <span class="brand"><i>✶</i>linger</span>
  <span class="chip"><i></i>127.0.0.1:${opts.port} — local</span>
</header>

<main>
  <div class="card">
    <div style="display:grid; gap:14px">
      <p class="eyebrow">Step 2 / 3 — identity</p>
      <h1>Connect your wallet</h1>
      <p class="lede">Your earnings go to this address. The signature is only proof of identity — it is a <b>message, not a transaction</b>: nothing is sent to the network and it costs nothing. Your private key never leaves your wallet.</p>
    </div>

    <div class="term">
      <div class="term-bar"><span>linger login</span><span id="status">ready</span></div>
      <div class="log" id="log"></div>

      <div class="addr hide" id="addrbox">
        <span class="k">Connected address</span>
        <span class="v" id="addr"></span>
        <div class="facts">
          <span>network <em id="net">—</em></span>
          <span>asset <em>USDC</em></span>
          <span>token account <em>created on first payout</em></span>
        </div>
      </div>
    </div>

    <div style="display:grid; gap:10px">
      <button id="primary" class="primary">Connect wallet</button>
      <p class="lede hide" id="nowallet" style="font-size:13.5px">No Solana wallet detected. Install <a href="https://phantom.app" target="_blank" rel="noreferrer">Phantom</a>, <a href="https://solflare.com" target="_blank" rel="noreferrer">Solflare</a> or <a href="https://backpack.app" target="_blank" rel="noreferrer">Backpack</a>, then reload this page.</p>
    </div>

    <!-- Istege bagli siralama adimi: yalnizca giristen SONRA gorunur.
         Kutu varsayilan ISARETSIZ — kazanci herkese acmak kullanicinin
         bilerek verdigi bir karar olmali. -->
    <div class="manual hide" id="profilebox">
      <p class="eyebrow" style="font-size:11.5px">Step 3 / 3 — optional</p>
      <p style="color:var(--ink)">Join the public leaderboard and the world map?</p>
      <p>Only a nickname and a country are shown, never your wallet address. Earnings from your own campaigns don't count. You can change or leave it any time with <b>linger profile</b>.</p>
      <input id="p-nick" maxlength="20" placeholder="nickname — 3–20 letters, digits, _ . -" autocomplete="off" spellcheck="false">
      <select id="p-country"><option value="">Don't show a country</option></select>
      <p id="p-guess" class="hide" style="font-size:12px"></p>
      <label class="check"><input type="checkbox" id="p-listed"> Show me on the leaderboard</label>
      <div class="pbtns">
        <button id="p-save" class="primary">Save</button>
        <button id="p-skip" class="linkish">Skip for now</button>
      </div>
      <p id="p-msg" class="hide"></p>
    </div>

    <ul class="notes">
      <li><i>·</i><span>This page only runs on your own computer; the address reaches the CLI locally.</span></li>
      <li><i>·</i><span>The signed message can never be submitted to the network — it is text, proof of identity only.</span></li>
      <li><i>·</i><span>Your private key never enters this page or the CLI.</span></li>
      <li><i>·</i><span>Use a regular wallet address. Multisig vaults and program accounts can\u2019t sign messages.</span></li>
    </ul>
  </div>
</main>

<footer>
  <span>✶ linger</span>
  <span>Ctrl-C in the terminal to close</span>
</footer>

<script>
const NONCE = ${JSON.stringify(opts.nonce)}
const $ = (id) => document.getElementById(id)
const DIM = 'var(--faint)', SOFT = 'var(--muted)', INK = 'var(--ink)'
const OK = 'var(--ok)', ACC = 'var(--accent)', ERR = 'var(--err)'

/* ─────────────────────────── gunluk ─────────────────────────── */

const lines = []
const esc = (s) => String(s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]))

function log(text, color) {
  lines.push({ text, color: color || SOFT })
  $('log').innerHTML = lines
    .map((l) => '<div style="color:' + l.color + '">' + esc(l.text) + '</div>')
    .join('') + '<div style="color:' + DIM + '">❯ <span class="caret">▌</span></div>'
}
function status(text, color) {
  $('status').textContent = text
  $('status').style.color = color || DIM
}

log('❯ linger login', DIM)
log('  wallet not connected', DIM)

/* ─────────────────────────── sunucu ─────────────────────────── */

async function post(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-linger-nonce': NONCE },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.hint || j.message || ('HTTP ' + r.status))
  return j
}

/* ─────────────────────────── cuzdan ─────────────────────────── */

/**
 * Enjekte edilen saglayicilar. Uc cuzdan da ayni temel API'yi sunar:
 * connect() ve signMessage(bytes). Onceligi Phantom > Solflare > Backpack.
 *
 * Eklentiler sayfadan SONRA enjekte olabilir, bu yuzden kisa bir sure
 * tekrar yoklanir.
 *
 * DIKKAT: bu blok bir sablon dizesinin ICINDE — backtick kullanma.
 */
function findWallet() {
  const ph = window.phantom && window.phantom.solana
  if (ph && ph.isPhantom) return { name: 'Phantom', p: ph }
  if (window.solflare && window.solflare.isSolflare) return { name: 'Solflare', p: window.solflare }
  if (window.backpack && window.backpack.isBackpack) return { name: 'Backpack', p: window.backpack }
  return null
}

async function waitForWallet(ms) {
  const end = Date.now() + ms
  for (;;) {
    const w = findWallet()
    if (w || Date.now() > end) return w
    await new Promise((r) => setTimeout(r, 150))
  }
}

/** Uint8Array → base64 (btoa yalnizca metin ister). */
function b64(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

/* ─────────────────────────── akis ─────────────────────────── */

let busy = false
let done = false

function setPrimary(label, o) {
  const b = $('primary')
  b.textContent = label
  b.disabled = !!(o && (o.busy || o.frozen))
  b.classList.toggle('quiet', !!(o && o.quiet))
}

async function connect() {
  if (busy || done) return
  busy = true
  setPrimary('looking for your wallet…', { busy: true })
  status('challenge', INK)

  try {
    const w = await waitForWallet(1500)
    if (!w) {
      $('nowallet').classList.remove('hide')
      throw new Error('no Solana wallet found — install one and reload the page')
    }

    setPrimary('approve in ' + w.name + '…', { busy: true })
    const conn = await w.p.connect()
    const pk = (conn && conn.publicKey) || w.p.publicKey
    const address = pk && pk.toString()
    if (!address) throw new Error(w.name + ' did not return an address')

    const ch = await post('/challenge', { address })
    log('→ sign-in message ready (not a transaction, nothing is sent)', SOFT)

    status('awaiting signature', INK)
    setPrimary('sign the message in ' + w.name + '…', { busy: true })
    log('⋯ waiting for your signature in ' + w.name, INK)

    // Mesaj UTF-8 bayt dizisi olarak imzalanir; cuzdan kullaniciya metni gosterir.
    const bytes = new TextEncoder().encode(ch.message)
    const res = await w.p.signMessage(bytes, 'utf8')
    // Phantom/Solflare { signature } dondurur; Backpack dogrudan bayt dizisi.
    const sig = res && res.signature ? res.signature : res
    if (!sig || !sig.length) throw new Error('did not receive a signature')

    await finish(address, ch.message, b64(sig))
  } catch (e) {
    fail(e)
  } finally {
    busy = false
  }
}

async function finish(address, message, signature) {
  log('✓ signature received', ACC)
  status('verifying', INK)
  setPrimary('verifying…', { busy: true })
  log('⋯ verifying signature', INK)

  const res = await post('/verify', { address, message, signature })

  done = true
  log('✓ verified — earnings will go to this address', ACC)
  log('✓ session saved to ~/.linger/credentials.json', DIM)
  status('connected', ACC)

  const chain = /Chain: (\S+)/.exec(message)
  $('net').textContent = chain ? chain[1] : '—'
  $('addr').textContent = res.publisherId
  $('addrbox').classList.remove('hide')
  $('nowallet').classList.add('hide')
  setPrimary('Connected ✓ — one optional step below', { quiet: true, frozen: true })

  openProfile()
}

function fail(e) {
  const msg = (e && e.message) ? e.message : String(e)
  log('✗ ' + msg, ERR)
  status('error', ERR)
  setPrimary('Try again', {})
}

$('primary').onclick = connect

/* ─────────────────────────── siralama (istege bagli) ─────────────────────────── */

const SERVER = ${JSON.stringify((opts.serverUrl ?? '').replace(/\/+$/, ''))}
const CODES = ${CODES}
const NICK = /^[A-Za-z0-9_.-]{3,20}$/
let regionName = (c) => c
try { const dn = new Intl.DisplayNames(['en'], { type: 'region' }); regionName = (c) => dn.of(c) || c } catch {}
const flag = (c) => String.fromCodePoint(...[...c].map((ch) => 127397 + ch.charCodeAt(0)))

function fillCountries() {
  const sel = $('p-country')
  CODES.map((c) => [c, regionName(c)])
    .sort((a, b) => a[1].localeCompare(b[1]))
    .forEach(([c, name]) => {
      const o = document.createElement('option')
      o.value = c; o.textContent = flag(c) + '  ' + name
      sel.appendChild(o)
    })
}

function profileMsg(text, color) {
  $('p-msg').textContent = text
  $('p-msg').style.color = color || SOFT
  $('p-msg').classList.remove('hide')
}

async function openProfile() {
  fillCountries()
  $('profilebox').classList.remove('hide')
  try {
    const r = await post('/profile/get', {})
    const p = r.profile
    if (p) {
      $('p-nick').value = p.nickname
      $('p-country').value = p.country || ''
      $('p-listed').checked = !!p.listed
    }
    // CCgather yaklasimi: ulke secilmemisse baglantidan tahmin; kaydedilene
    // kadar hicbir yere yazilmaz.
    if ((!p || !p.country) && r.suggestedCountry) {
      $('p-country').value = r.suggestedCountry
      $('p-guess').textContent = regionName(r.suggestedCountry) + ' was picked from your connection — change it if that is wrong.'
      $('p-guess').classList.remove('hide')
    }
  } catch { /* okunamadiysa form bos kalir; kaydetmek yine calisir */ }
}

$('p-save').onclick = async () => {
  const nickname = $('p-nick').value.trim()
  if (!NICK.test(nickname)) { profileMsg('Nickname: 3–20 letters, digits, _ . -', ERR); return }
  $('p-save').disabled = true
  try {
    const r = await post('/profile/save', { nickname, country: $('p-country').value || null, listed: $('p-listed').checked })
    const listed = r.profile && r.profile.listed
    log(listed ? '✓ leaderboard: listed as ' + r.profile.nickname : '✓ leaderboard profile saved (not listed)', ACC)
    profileMsg(listed
      ? 'Saved. You will appear within a minute once you have earnings from other advertisers.'
      : 'Saved. You are not listed.', OK)
    if (SERVER && listed) {
      const a = document.createElement('a')
      a.href = SERVER + '/#board'; a.target = '_blank'; a.rel = 'noopener'
      a.textContent = 'See the leaderboard →'
      a.className = 'linkish'
      a.style.justifySelf = 'start'
      $('p-msg').after(a)
    }
    $('p-skip').classList.add('hide')
    status('done — you can close this page', ACC)
  } catch (e) {
    profileMsg(e && e.message ? e.message : String(e), ERR)
    $('p-save').disabled = false
  }
}

$('p-skip').onclick = async () => {
  try { await post('/profile/skip', {}) } catch {}
  $('profilebox').classList.add('hide')
  log('  leaderboard skipped — join later with: linger profile', DIM)
  status('done — you can close this page', ACC)
}


// Eklenti sayfadan SONRA enjekte olabilir; sessizce bir kez daha bak.
waitForWallet(1500).then((w) => {
  if (w) log('  ' + w.name + ' detected', DIM)
  else log('  no Solana wallet detected — install Phantom, Solflare or Backpack', DIM)
})
</script>
</body>
</html>`
}
