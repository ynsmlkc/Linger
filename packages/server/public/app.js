/* Linger — tarayici tarafi ortak islevler.
 *
 * Cerceve yok, derleme adimi yok. Bes sayfalik bir site icin React
 * getirmek, indirilecek 40 KB'i 200 KB yapardi ve tek kazanci bizim
 * rahatimiz olurdu.
 *
 * Solana SDK de YOK. Giriste imzalanan sey bir islem degil, sunucunun
 * urettigi OKUNABILIR bir mesaj; tarayici yalnizca cuzdana imzalatip geri
 * gonderiyor. SDK'yi tarayiciya koymak yuzlerce KB demekti ve tek
 * ihtiyacimiz bir mesaji imzalatmak.
 */

/* ─────────────────────────── para ─────────────────────────── */

/**
 * Micro metnini dolara cevirir. BigInt, float DEGIL.
 *
 * 1 USDC = 1.000.000 micro. `parseFloat` ile bolmek 2^53 ustunde
 * sessizce yuvarlar ve kullanicinin bakiyesini degistirir.
 */
export function usd(micros) {
  const v = BigInt(micros);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / 1000000n;
  const frac = (a % 1000000n).toString().padStart(6, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + '$' + whole.toString() + (frac ? '.' + frac : '');
}

/** "40.25" → 402500000n. Float'a hic ugramaz. */
export function toMicros(text) {
  const m = /^(\d*)(?:\.(\d{0,6}))?$/.exec(String(text).trim());
  if (!m || (!m[1] && !m[2])) return null;
  return BigInt(m[1] || '0') * 1000000n + BigInt((m[2] || '').padEnd(6, '0'));
}

export const short = (a) => (a && a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a || '');

/* ─────────────────────────── sunucu ─────────────────────────── */

const TOKEN_KEY = 'linger.token';
const ROLE_KEY = 'linger.role';
const ADDR_KEY = 'linger.address';

export const session = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  get role() { return localStorage.getItem(ROLE_KEY); },
  get address() { return localStorage.getItem(ADDR_KEY); },
  save(token, role, address) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(ROLE_KEY, role);
    localStorage.setItem(ADDR_KEY, address);
  },
  clear() { [TOKEN_KEY, ROLE_KEY, ADDR_KEY].forEach((k) => localStorage.removeItem(k)); },
};

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.hint || body?.message || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * Sunucu cagrisi.
 *
 * Site sunucuyla AYNI adreste duruyor, bu yuzden yol goreli ve CORS yok.
 * Ayri bir alan adina koysaydik her uc icin CORS basliklari gerekirdi ve
 * cerez/kimlik islerinin hepsi zorlasirdi.
 */
export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'x-linger-client-version': '0.1.1' };
  if (body) headers['content-type'] = 'application/json';
  if (auth && session.token) headers.authorization = `Bearer ${session.token}`;

  let res;
  try {
    res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    // Ag hatasi ile sunucu hatasini AYIRIYORUZ: kullaniciya "tekrar dene"
    // demekle "oturumun dustu" demek farkli seyler.
    throw new ApiError(0, { message: 'Cannot reach the server' });
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

/* ─────────────────────────── cuzdan ─────────────────────────── */

/**
 * Enjekte edilen Solana cuzdani. Phantom, Solflare ve Backpack ayni temel
 * API'yi sunar: `connect()` ve `signMessage(bytes)`. Oncelik Phantom >
 * Solflare > Backpack.
 *
 * Eklentiler sayfadan SONRA enjekte olabilir; bu yuzden kisa bir sure
 * tekrar yoklanir.
 */
function findWallet() {
  const ph = window.phantom?.solana;
  if (ph?.isPhantom) return { name: 'Phantom', p: ph };
  if (window.solflare?.isSolflare) return { name: 'Solflare', p: window.solflare };
  if (window.backpack?.isBackpack) return { name: 'Backpack', p: window.backpack };
  return null;
}

async function waitForWallet(ms = 1500) {
  const end = Date.now() + ms;
  for (;;) {
    const w = findWallet();
    if (w || Date.now() > end) return w;
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** Sayfa acildiginda: bir Solana cuzdani var mi? */
export async function walletReady() {
  return (await waitForWallet()) !== null;
}

/** Uint8Array → base64. `btoa` yalnizca metin ister. */
function toBase64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/* ─────────────────────────── giris (imza) ─────────────────────────── */

/**
 * Cuzdanla giris. Sifre yok, hesap yok — adres kimligin kendisi.
 *
 * Uc adim: sunucudan bir mesaj iste, cuzdana imzalat, imzayi geri gonder.
 * Sunucu imzayi dogrularsa token verir.
 *
 * Imzalanan sey bir ISLEM DEGIL, okunabilir bir metin: aga gonderilmesi
 * imkansiz. Yani bu imza hicbir zaman para hareket ettiremez, yalnizca
 * "bu adres benim"i kanitlar.
 *
 * `onStep` her adimda dugmenin yazisini degistiriyor. Cuzdan penceresi
 * acilmadan once kullanicinin ne bekledigini bilmesi gerekiyor — yoksa
 * donen bir dugmeye bakip sayfanin dondugunu saniyor.
 */
export async function login(role, onStep = () => {}) {
  onStep('Looking for your wallet…');
  const w = await waitForWallet();
  if (!w) throw new Error('No Solana wallet found — install Phantom, Solflare or Backpack');

  onStep(`Approve in ${w.name}…`);
  const conn = await w.p.connect();
  const address = (conn?.publicKey ?? w.p.publicKey)?.toString();
  if (!address) throw new Error(`${w.name} returned no address`);

  onStep('Preparing…');
  const challenge = await api('/v1/auth/challenge', {
    method: 'POST', auth: false, body: { address },
  });

  onStep(`Sign the message in ${w.name}…`);
  const res = await w.p.signMessage(new TextEncoder().encode(challenge.message), 'utf8');
  // Phantom/Solflare { signature } dondurur; Backpack dogrudan bayt dizisi.
  const sig = res?.signature ?? res;
  if (!sig?.length) throw new Error('No signature received');

  onStep('Verifying…');
  // Rolu SUNUCU dogruluyor; buradaki deger yalnizca hangi yetkilerin
  // istendigini soyluyor, kendi kendine yetki vermiyor.
  const { token } = await api('/v1/auth/verify', {
    method: 'POST', auth: false,
    body: { address, message: challenge.message, signature: toBase64(sig), role },
  });

  session.save(token, role, address);
  return { address, role };
}

/* ─────────────────────────── kucuk yardimcilar ─────────────────────────── */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function show(el, on) { el?.classList.toggle('hidden', !on); }

/**
 * Onay isareti — yazi tipi glifi degil, cizilmis SVG.
 *
 * `✓` karakteri her isletim sisteminde farkli boyutta ve kalinlikta
 * geliyor; macOS'ta ince, Windows'ta kalin, Linux'ta bazen hic yok.
 * Cizersek her yerde ayni.
 */
const TICK = `<svg class="tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8.5l3.6 3.6L13.5 4.7"/></svg>`;

export function copyButton(btn, text) {
  btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text()); } catch { /* izin yok */ }
    const tag = btn.querySelector('.tag') || btn;
    if (tag.dataset.busy) return;              // ust uste tiklamada etiketi kaybetme
    tag.dataset.busy = '1';
    tag.dataset.before = tag.textContent;

    tag.innerHTML = TICK;
    tag.classList.add('done');
    setTimeout(() => {
      tag.textContent = tag.dataset.before;
      tag.classList.remove('done');
      delete tag.dataset.busy;
    }, 1600);
  });
}

/** Solana Explorer baglantilari. Ana aga gecerken `NETWORK` degisir. */
export const NETWORK = 'devnet';
const cluster = NETWORK === 'mainnet' ? '' : '?cluster=devnet';
export const explorer = {
  tx: (h) => `https://explorer.solana.com/tx/${h}${cluster}`,
  account: (a) => `https://explorer.solana.com/address/${a}${cluster}`,
};
