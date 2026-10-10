#!/usr/bin/env node
/**
 * Devnet USDC havuzu — test hesaplarini fonlamak icin.
 *
 * Circle'in musluğu (faucet.circle.com) reCAPTCHA ile korunuyor ve
 * otomatiklestirilemez. Onun yerine bir kez alinan USDC'yi DOLASIMDA tutuyoruz:
 *
 *     havuz → test reklamvereni → hazine → (odeme) → test yayincisi → havuz
 *
 * Odeme cikan test yayincisindan parayi geri topluyoruz, boylece ayni USDC
 * defalarca kullanilabiliyor. Sizinti yalnizca platform payi: her turda
 * harcananin yarisi hazinede kaliyor ve geri alinmiyor — cunku o para
 * defterde bir yukumluluk, zincirden cekmek solvency'yi bozardi.
 *
 * Yayincinin yalnizca bir adresi olmasi yeter: hicbir "hesap kurma" ya da
 * "kabul izni" adimi yok, USDC hesabini ilk odemede gonderen acar.
 *
 *   node scripts/devnet-faucet.mjs init
 *   node scripts/devnet-faucet.mjs balance
 *   node scripts/devnet-faucet.mjs new-advertiser 2
 *   node scripts/devnet-faucet.mjs new-publisher
 *   node scripts/devnet-faucet.mjs reclaim <GIZLI_ANAHTAR>
 *
 * Anahtar `.devnet-faucet.json` icinde, git'e girmiyor.
 */

import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  LAMPORTS_PER_SOL, sendAndConfirmTransaction,
} from '@solana/web3.js'
import {
  getAssociatedTokenAddressSync, getAccount,
  createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction,
} from '@solana/spl-token'
import bs58 from 'bs58'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const KOK = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOSYA = join(KOK, '.devnet-faucet.json')

const RPC = process.env.LINGER_RPC ?? 'https://api.devnet.solana.com'
const conn = new Connection(RPC, 'confirmed')
// Circle'in devnet USDC'si. Kendi token'imiz DEGIL (§8 tuzak #8).
const MINT = new PublicKey(process.env.LINGER_USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const DECIMALS = 6

/* ─────────────────────────── yardimcilar ─────────────────────────── */

/** "1.5" → 1_500_000n. Float'a UGRAMAZ. */
function microya(metin) {
  const [tam, kesir = ''] = String(metin).split('.')
  return BigInt(tam) * 10n ** BigInt(DECIMALS) + BigInt((kesir + '000000').slice(0, DECIMALS))
}
const metne = (m) => `${m / 10n ** 6n}.${String(m % 10n ** 6n).padStart(6, '0')}`

async function usdcBakiye(owner) {
  try {
    const ata = getAssociatedTokenAddressSync(MINT, owner, true)
    return (await getAccount(conn, ata)).amount
  } catch {
    return null                          // USDC hesabi (ATA) henuz yok
  }
}

function havuz() {
  if (!existsSync(DOSYA)) {
    console.error(
      `Havuz kurulmamis. Once bir kez tohumla:\n` +
      `  node scripts/devnet-faucet.mjs init\n` +
      `Sonra cikan adrese faucet.circle.com'dan (Solana devnet) USDC gonder.`,
    )
    process.exit(1)
  }
  return Keypair.fromSecretKey(bs58.decode(JSON.parse(readFileSync(DOSYA, 'utf8')).secret))
}

/** Devnet SOL. Hiz siniri sik: basarisiz olursa faucet.solana.com'u oner. */
async function airdrop(pk, sol = 1) {
  try {
    const sig = await conn.requestAirdrop(pk, sol * LAMPORTS_PER_SOL)
    await conn.confirmTransaction(sig, 'confirmed')
    return true
  } catch {
    console.error(`airdrop basarisiz (hiz siniri) — https://faucet.solana.com adresinden ${pk.toBase58()} icin iste`)
    return false
  }
}

/** Havuzdan `hedef`e USDC yollar; hedefin USDC hesabini havuz acar. */
async function usdcYolla(kp, hedef, miktar, imzacilar = [kp]) {
  const kaynakAta = getAssociatedTokenAddressSync(MINT, kp.publicKey)
  const hedefAta = getAssociatedTokenAddressSync(MINT, hedef, true)
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, hedefAta, hedef, MINT),
    createTransferCheckedInstruction(kaynakAta, MINT, hedefAta, kp.publicKey, miktar, DECIMALS),
  )
  return sendAndConfirmTransaction(conn, tx, imzacilar)
}

/* ─────────────────────────── komutlar ─────────────────────────── */

const [komut, ...arg] = process.argv.slice(2)

if (komut === 'init') {
  if (existsSync(DOSYA)) {
    console.log('zaten var:', havuz().publicKey.toBase58())
  } else {
    const kp = Keypair.generate()
    writeFileSync(
      DOSYA,
      JSON.stringify({ secret: bs58.encode(kp.secretKey), address: kp.publicKey.toBase58() }, null, 2),
      { mode: 0o600 },
    )
    await airdrop(kp.publicKey, 2)
    console.log('havuz olusturuldu:', kp.publicKey.toBase58())
    console.log('faucet.circle.com → Solana → Devnet → bu adresi yapistir')
  }
} else if (komut === 'balance') {
  const kp = havuz()
  const usdc = await usdcBakiye(kp.publicKey)
  const sol = await conn.getBalance(kp.publicKey)
  console.log(`havuz ${kp.publicKey.toBase58()}`)
  console.log(`  USDC ${usdc === null ? '(henuz yok)' : metne(usdc)}`)
  console.log(`  SOL  ${(sol / LAMPORTS_PER_SOL).toFixed(4)}`)
} else if (komut === 'new-advertiser') {
  // Yeni test reklamvereni: adres + biraz SOL (ucret) + USDC.
  const tutar = arg[0] ?? '2'
  const kp = havuz()
  const yeni = Keypair.generate()
  await sendAndConfirmTransaction(conn, new Transaction().add(
    SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: yeni.publicKey, lamports: 0.01 * LAMPORTS_PER_SOL }),
  ), [kp])
  await usdcYolla(kp, yeni.publicKey, microya(tutar))
  console.log(JSON.stringify({ address: yeni.publicKey.toBase58(), secret: bs58.encode(yeni.secretKey), usdc: tutar }))
} else if (komut === 'new-publisher') {
  // Test yayincisi: yalnizca bir adres. USDC hesabini ilk odemede gonderen acar.
  const yeni = Keypair.generate()
  console.log(JSON.stringify({ address: yeni.publicKey.toBase58(), secret: bs58.encode(yeni.secretKey) }))
} else if (komut === 'reclaim') {
  // Test hesabindaki USDC'yi havuza geri al. Ucreti havuz oder.
  const kp = havuz()
  const kaynak = Keypair.fromSecretKey(bs58.decode(arg[0]))
  const bakiye = await usdcBakiye(kaynak.publicKey)
  if (!bakiye) {
    console.log('geri alinacak USDC yok')
  } else {
    const kaynakAta = getAssociatedTokenAddressSync(MINT, kaynak.publicKey)
    const havuzAta = getAssociatedTokenAddressSync(MINT, kp.publicKey)
    const tx = new Transaction().add(
      createTransferCheckedInstruction(kaynakAta, MINT, havuzAta, kaynak.publicKey, bakiye, DECIMALS),
    )
    tx.feePayer = kp.publicKey
    await sendAndConfirmTransaction(conn, tx, [kp, kaynak])
    console.log(`${metne(bakiye)} USDC havuza dondu`)
  }
} else {
  console.log(`kullanim:
  init                     havuzu olustur (bir kez)
  balance                  havuzdaki USDC ve SOL
  new-advertiser [tutar]   fonlanmis test reklamvereni  → JSON
  new-publisher            test yayincisi (yalnizca adres)  → JSON
  reclaim <GIZLI_ANAHTAR>  hesaptaki USDC'yi havuza al`)
}
