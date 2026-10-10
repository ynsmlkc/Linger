#!/usr/bin/env node
/**
 * Devnet'te bir reklamveren kurar: giris yapar, butce yatirir, kampanya acar.
 *
 * Amaci para kazanmak degil — devnet USDC'nin degeri yok. Amaci ZINCIRIN
 * KENDILIGINDEN donmesi: butce yatar, reklam gosterilir, kazanc deftere
 * yazilir, esik gecilince odeme zincire cikar. Bugune kadar bu adimlarin
 * her biri tek tek kanitlandi ama hepsi elle tetiklenmisti.
 *
 * Reklamveren kimligi havuz cuzdani. Ayri bir cuzdan uretmiyoruz: para
 * GONDEREN ADRESE gore eslesiyor (ADR-021), yani butceyi yatiran cuzdan ile
 * giris yapan cuzdan AYNI olmak zorunda.
 *
 *   node scripts/test-campaign.mjs            # durumu goster
 *   node scripts/test-campaign.mjs --apply    # gercekten kur
 */

import {
  Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction,
} from '@solana/web3.js'
import {
  getAssociatedTokenAddressSync, getAccount,
  createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction,
} from '@solana/spl-token'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const KOK = join(dirname(fileURLToPath(import.meta.url)), '..')
const API = process.env.LINGER_SERVER ?? 'https://lingerserver-production.up.railway.app'
const RPC = process.env.LINGER_RPC ?? 'https://api.devnet.solana.com'
// Circle'in devnet USDC'si. Sunucudakiyle AYNI mint olmali (§8 tuzak #8).
const MINT = new PublicKey(process.env.LINGER_USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const UYGULA = process.argv.includes('--apply')

const conn = new Connection(RPC, 'confirmed')
const kp = Keypair.fromSecretKey(bs58.decode(JSON.parse(readFileSync(join(KOK, '.devnet-faucet.json'), 'utf8')).secret))
const adres = kp.publicKey.toBase58()

const log = (...a) => console.log(...a)
const usd = (s) => {
  const v = BigInt(s)
  return '$' + (v / 1_000_000n) + '.' + String((v % 1_000_000n) / 10_000n).padStart(2, '0')
}

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(data)}`)
  return data
}

/**
 * Cuzdanla giris.
 *
 * Imzalanan sey bir islem degil, sunucunun urettigi okunabilir bir mesaj;
 * aga gonderilmesi imkansiz. Yani bu imza para hareket ettiremez, yalnizca
 * adresin bize ait oldugunu kanitlar.
 */
async function login(role) {
  const ch = await api('/v1/auth/challenge', { method: 'POST', body: { address: adres } })
  const imza = nacl.sign.detached(Buffer.from(ch.message, 'utf8'), kp.secretKey)
  const { token } = await api('/v1/auth/verify', {
    method: 'POST',
    body: { address: adres, message: ch.message, signature: Buffer.from(imza).toString('base64'), role },
  })
  return token
}

/** USDC bakiyesi (micro). USDC hesabi yoksa 0. */
async function usdcMicro() {
  try {
    return (await getAccount(conn, getAssociatedTokenAddressSync(MINT, kp.publicKey))).amount
  } catch {
    return 0n
  }
}

/** Butceyi hazineye yollar. Eslesme gonderen adrese gore. */
async function yatir(hedef, micro) {
  const hedefSahip = new PublicKey(hedef)
  const kaynakAta = getAssociatedTokenAddressSync(MINT, kp.publicKey)
  const hedefAta = getAssociatedTokenAddressSync(MINT, hedefSahip, true)
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, hedefAta, hedefSahip, MINT),
    createTransferCheckedInstruction(kaynakAta, MINT, hedefAta, kp.publicKey, micro, 6),
  )
  return sendAndConfirmTransaction(conn, tx, [kp])
}

/* ──────────────────────────────────────────────────────────── */

const bakiye = await usdcMicro()

log('\n  reklamveren  ' + adres)
log('  butce        ' + usd(bakiye.toString()) + ' USDC\n')

const token = await login('advertiser')
const me = await api('/v1/advertiser/me', { token })

log('  sunucudaki bakiye   ' + usd(me.balanceMicros))
log('  harcanabilir        ' + usd(me.spendableMicros))
log('  kampanya sayisi     ' + me.campaigns.length)
log('  yatirma adresi      ' + (me.deposit?.address ?? '(kapali)'))

if (!UYGULA) {
  log('\n  (kuru calisma — gercekten kurmak icin --apply)\n')
  process.exit(0)
}

/* ── butce yatir ── */

// Tam sent'e yuvarla (asagi): 4 hane koruyup dusuk kismi atiyoruz.
const yatirilacak = (bakiye / 10_000n) * 10_000n
if (yatirilacak > 0n) {
  log('\n  ' + usd(yatirilacak.toString()) + ' USDC yatiriliyor…')
  const imza = await yatir(me.deposit.address, yatirilacak)
  log('  tx  ' + imza)

  // Sunucu zinciri tariyor; kredi aninda gelmiyor.
  log('  defterde gorunmesi bekleniyor…')
  for (let i = 1; i <= 40; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    const m = await api('/v1/advertiser/me', { token })
    if (BigInt(m.balanceMicros) > BigInt(me.balanceMicros)) {
      log('  ✓ yazildi — bakiye ' + usd(m.balanceMicros))
      break
    }
    if (i === 40) log('  ! 3 dakikada yazilmadi; RPC gecikmis olabilir')
  }
}

/* ── kampanya ── */

/**
 * Reklam metni. Bunun bir reklam OLDUGU ve devnet oldugu satirin kendisinde
 * yaziyor: statusline'da kaynagi belirsiz bir satir gostermek, reklami
 * icerik gibi sunmak olurdu.
 */
const kampanya = {
  brand: 'Linger',
  // Satir sinirinin 80 karakter oldugunu unutma: marka ve alan adi da
  // ayni satira giriyor, yalnizca bu metin degil.
  text: 'Test campaign — proving the payout loop on devnet',
  cta: 'linger.sh',
  // CPM = bin gosterim basina. 5 USDC/1000 → gosterim basina 0,005 USDC,
  // yarisi yayinciya: 0,0025 USDC. Esigi makul surede gecirir.
  bidCpmMicros: String(5n * 1_000_000n),
}

const c = await api('/v1/advertiser/campaigns', { method: 'POST', token, body: kampanya })
log('\n  ✓ kampanya acildi  ' + c.id)
log('    ' + kampanya.brand + ' — ' + kampanya.text)
log('    teklif  ' + usd(kampanya.bidCpmMicros) + ' / 1000 gosterim\n')
