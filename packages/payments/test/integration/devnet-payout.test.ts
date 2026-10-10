/**
 * Devnet entegrasyon testi — `SolanaRail` GERCEK agda.
 *
 * Kapali gelir; acmak icin:  LINGER_DEVNET=1 pnpm --filter @linger/payments test:devnet
 *
 * Devnet'in SOL musluğu hiz siniri koyuyor (429). Test once `requestAirdrop`
 * dener; olmazsa https://faucet.solana.com adresinden bir devnet cuzdanina
 * SOL alip gizli anahtarini (base58) `LINGER_DEVNET_PAYER` ile ver.
 *
 * Circle'in USDC musluğu reCAPTCHA'li ve otomatiklestirilemez. Bu yuzden test
 * KENDI gecici mint'ini olusturur (6 hane, USDC ile ayni hassasiyet, dondurma
 * yetkisi test anahtarinda). Rail mint'i yapilandirmadan aldigi icin kod
 * yolu birebir ayni; degersiz devnet token'i, atilabilir anahtarlar.
 *
 * Kanitlanan davranislar:
 *   • ATA'si olmayan alicilar icin hesap ilk odemede acilir
 *   • Tek transaction'da coklu odeme, tutarlar zincirde birebir tutar
 *   • Dondurulmus hedef TUM batch'i dusurur, suclu talimat indeksinden bulunur
 *   • Ayni byte'lari ikinci kez gondermek ikinci odeme YAPMAZ (idempotent)
 *   • Blockhash omru dolmus, hic gorulmemis transaction `expired` doner
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey,
} from '@solana/web3.js'
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo, freezeAccount,
  getAssociatedTokenAddressSync, getAccount,
} from '@solana/spl-token'
import bs58 from 'bs58'
import { micros } from '@linger/protocol'
import { SolanaRail, RPC_URL } from '../../src/solana-rail.js'

const enabled = process.env['LINGER_DEVNET'] === '1'
const RPC = process.env['LINGER_RPC'] ?? RPC_URL.devnet

describe.skipIf(!enabled)('SolanaRail — devnet', () => {
  const conn = new Connection(RPC, 'confirmed')
  const given = process.env['LINGER_DEVNET_PAYER']
  const payer = given ? Keypair.fromSecretKey(bs58.decode(given)) : Keypair.generate()
  let mint: PublicKey
  let rail: SolanaRail

  const balanceOf = async (owner: PublicKey): Promise<bigint> => {
    try { return (await getAccount(conn, getAssociatedTokenAddressSync(mint, owner))).amount }
    catch { return 0n }
  }

  beforeAll(async () => {
    // Devnet SOL. Kullanici hazir bir cuzdan verdiyse airdrop denenmez.
    let ok = given !== undefined && (await conn.getBalance(payer.publicKey)) > 0.1 * LAMPORTS_PER_SOL
    for (let i = 0; i < 2 && !ok; i++) {
      try {
        const sig = await conn.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL)
        await conn.confirmTransaction(sig, 'confirmed')
        ok = true
      } catch { await new Promise((r) => setTimeout(r, 4000)) }
    }
    if (!ok) throw new Error(`devnet SOL yok: https://faucet.solana.com adresinden ${payer.publicKey.toBase58()} icin SOL al, sonra bu cuzdanin gizli anahtarini LINGER_DEVNET_PAYER ile ver`)

    mint = await createMint(conn, payer, payer.publicKey, payer.publicKey, 6)   // dondurma yetkisi: payer
    const src = await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey)
    await mintTo(conn, payer, mint, src.address, payer, 1_000_000_000n)          // 1.000 birim

    rail = new SolanaRail({
      rpcUrl: RPC, sourceSecret: bs58.encode(payer.secretKey), usdcMint: mint.toBase58(),
    })
  }, 120_000)

  it('kaynak durumu: bakiye ve SOL okunur', async () => {
    const s = await rail.sourceStatus()
    expect(s.usdcBalance).toBe(1_000_000_000n)
    expect(s.availableLamports).toBeGreaterThan(0n)
  }, 60_000)

  it('hedef dogrulama: taze cuzdan / PDA / token hesabi / mint ayirt edilir', async () => {
    const fresh = Keypair.generate().publicKey
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from('x')], mint)
    const payerAta = getAssociatedTokenAddressSync(mint, payer.publicKey)

    const [f, p, t, m] = await rail.validateDestinations([
      fresh.toBase58(), pda.toBase58(), payerAta.toBase58(), mint.toBase58(),
    ])
    expect(f).toMatchObject({ onCurve: true, isTokenAccount: false, isMint: false, ataExists: false })
    expect(p!.onCurve).toBe(false)
    expect(t!.isTokenAccount).toBe(true)
    expect(m!.isMint).toBe(true)
  }, 60_000)

  it('coklu odeme: ATA\'lar acilir, tutarlar zincirde BIREBIR tutar', async () => {
    const a = Keypair.generate().publicKey, b = Keypair.generate().publicKey, c = Keypair.generate().publicKey
    const items = [
      { publisherId: 'a', address: a.toBase58(), amount: micros(1_500_000n) },
      { publisherId: 'b', address: b.toBase58(), amount: micros(2_250_000n) },
      { publisherId: 'c', address: c.toBase58(), amount: micros(1n) },        // 1 micro: yuvarlama yok
    ]
    const receipt = await rail.prepare({ batchId: 'it-1', items })
    expect(receipt.txHash.length).toBeGreaterThan(80)
    await rail.send(receipt)

    let r = await rail.reconcile(receipt)
    for (let i = 0; i < 30 && r.state === 'pending'; i++) {
      await new Promise((res) => setTimeout(res, 2000))
      r = await rail.reconcile(receipt)
    }
    expect(r.state).toBe('settled')
    expect(r.feeCharged).toBeGreaterThan(0n)

    expect(await balanceOf(a)).toBe(1_500_000n)
    expect(await balanceOf(b)).toBe(2_250_000n)
    expect(await balanceOf(c)).toBe(1n)
  }, 240_000)

  it('ayni transaction IKI KEZ gonderilirse ikinci odeme YAPILMAZ', async () => {
    const d = Keypair.generate().publicKey
    const receipt = await rail.prepare({
      batchId: 'it-2', items: [{ publisherId: 'd', address: d.toBase58(), amount: micros(700_000n) }],
    })
    await rail.send(receipt)
    await rail.send(receipt)         // ayni byte'lar → ayni imza → ag ikinciyi uygulamaz

    let r = await rail.reconcile(receipt)
    for (let i = 0; i < 30 && r.state === 'pending'; i++) {
      await new Promise((res) => setTimeout(res, 2000))
      r = await rail.reconcile(receipt)
    }
    expect(r.state).toBe('settled')
    expect(await balanceOf(d)).toBe(700_000n)     // 1.400.000 DEGIL
  }, 240_000)

  it('dondurulmus hedef TUM batch\'i dusurur — suclu indeksten bulunur, kimse odenmez', async () => {
    const ok = Keypair.generate().publicKey
    const bad = Keypair.generate().publicKey

    // `bad` icin ATA'yi ac ve DONDUR.
    const badAta = await getOrCreateAssociatedTokenAccount(conn, payer, mint, bad)
    await freezeAccount(conn, payer, badAta.address, mint, payer)

    const status = await rail.validateDestinations([bad.toBase58()])
    expect(status[0]!.ataFrozen).toBe(true)

    // On kontrolu ATLAYARAK gonder: TOCTOU senaryosu — hedef arada bozuldu.
    const receipt = await rail.prepare({
      batchId: 'it-3',
      items: [
        { publisherId: 'ok', address: ok.toBase58(), amount: micros(500_000n) },
        { publisherId: 'bad', address: bad.toBase58(), amount: micros(500_000n) },
      ],
    })
    // Simulasyon (preflight) zaten reddedebilir; bu da KESIN red demektir.
    let rejected = false
    try { await rail.send(receipt) } catch { rejected = true }

    if (!rejected) {
      let r = await rail.reconcile(receipt)
      for (let i = 0; i < 30 && r.state === 'pending'; i++) {
        await new Promise((res) => setTimeout(res, 2000))
        r = await rail.reconcile(receipt)
      }
      expect(r.state).toBe('failed')
      const culprit = receipt.opIndex.find((o) => o.index === r.opResults[0]!.index)
      expect(culprit?.publisherId).toBe('bad')
    }
    // Atomiklik: masum alici da odenmedi.
    expect(await balanceOf(ok)).toBe(0n)
  }, 240_000)

  it('blockhash omru dolmus ve hic gorulmemis transaction "expired" doner', async () => {
    const phantom = {
      batchId: 'it-4', txHash: bs58.encode(new Uint8Array(64).fill(7)),
      serializedTx: '', recentBlockhash: 'x', lastValidBlockHeight: 1, feeBid: 0n, opIndex: [],
    }
    const r = await rail.reconcile(phantom)
    expect(r.state).toBe('expired')
  }, 60_000)
})
