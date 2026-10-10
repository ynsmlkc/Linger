/**
 * `PaymentRail`'in GERCEK uygulamasi — Solana agina baglanir.
 *
 * Buraya kadarki her sey mock ray uzerinde calisti; burasi paranin fiilen
 * hareket ettigi yer. Dolayisiyla buradaki her karar geri alinamaz sonuclar
 * dogurur: zincire yazilan bir odeme geri cagirilamaz.
 *
 * Uc kural:
 *
 *   1. TRANSACTION BIR KEZ KURULUR. Retry AYNI byte'lari gonderir; yeniden
 *      insa etmek yeni blockhash ve yeni imza uretir ve ayni odemeyi IKI KEZ
 *      yapabilir (§8 tuzak #9). Ayni byte'lar ayni imzadir; ag onu ikinci kez
 *      uygulamaz.
 *   2. "GONDERDIM" ODENDI DEMEK DEGIL. Yalnizca `err === null` VE kesinlesmis
 *      (`finalized`) odendi demektir. Zincire girip patlayan transaction
 *      ucret keser, para gondermez.
 *   3. USDC BAKIYESI YETMEZ. SOL'u biten hesap sessizce durur ve USDC alarmi
 *      susar (§8 tuzak #11). Ucreti de, alicilar icin acilan ATA kiralarini
 *      da SOL oder; ikisi ayri izlenir.
 *
 * Solana'ya ozgu iki fark:
 *   • Batch ucret KAZANDIRIR: ucret imza basina, operasyon basina degil.
 *     Yine de batch kucuk tutulur — atomiktir, tek bozuk hedef hepsini dusurur.
 *   • Transaction 1232 bayti gecemez; ATA acmak yer kaplar. Bu yuzden batch
 *     boyutu bayt olarak da denetlenir.
 */

import {
  ComputeBudgetProgram, Connection, Keypair, PublicKey,
  TransactionMessage, VersionedTransaction, type TransactionInstruction,
} from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction, getAssociatedTokenAddressSync,
  unpackAccount,
} from '@solana/spl-token'
import bs58 from 'bs58'
import { USDC_DECIMALS, micros } from '@linger/protocol'
import type {
  PaymentRail, PayoutBatch, DestinationStatus, SubmissionReceipt,
  SettlementResult, SourceAccountStatus,
} from './rail.js'
import type { Network } from './wallet.js'

export interface SolanaRailConfig {
  readonly rpcUrl: string
  /** Sicak cuzdanin gizli anahtari. Yalnizca sunucuda, secret manager'dan. */
  readonly sourceSecret: string
  /**
   * Odenecek USDC mint'i.
   *
   * §8 tuzak #8: Circle'in USDC'si kullanilir, kendi token'imiz DEGIL. Ayni
   * adi tasiyan baska mint'ler farkli varliktir; yanlis mint'e yapilan odeme,
   * kullanicinin cuzdaninda "USDC" gorunur ama degersizdir.
   */
  readonly usdcMint: string
  /** "Odendi" icin gereken taahhut. Varsayilan `finalized` — geri donmez. */
  readonly commitment?: 'confirmed' | 'finalized'
  /** Oncelik ucreti (micro-lamport / compute unit). Ag tikandiginda yukselir. */
  readonly priorityFeeMicroLamports?: number
}

/** Bir transaction'in bayt tavani (paket boyutu). */
export const MAX_TX_BYTES = 1232
const BASE_FEE_LAMPORTS = 5_000n
const DEFAULT_PRIORITY_MICRO_LAMPORTS = 1_000
/** Kira muafiyeti icin hesap basina ayrilan tampon; ATA kirasi ~0.00204 SOL. */
const ATA_RENT_LAMPORTS = 2_039_280n

/** Compute unit tahmini: transferChecked ≈ 6.2k, ATA olusturma ≈ 30k. Paylar dahil. */
const CU_BASE = 10_000
const CU_PER_TRANSFER = 12_000
const CU_PER_ATA_CREATE = 35_000

export class SolanaRail implements PaymentRail {
  readonly #conn: Connection
  readonly #payer: Keypair
  readonly #mint: PublicKey
  readonly #settleAt: 'confirmed' | 'finalized'

  constructor(private readonly cfg: SolanaRailConfig) {
    this.#conn = new Connection(cfg.rpcUrl, 'confirmed')
    this.#payer = parseSecretKey(cfg.sourceSecret)
    this.#mint = new PublicKey(cfg.usdcMint)
    this.#settleAt = cfg.commitment ?? 'finalized'
  }

  get publicKey(): string { return this.#payer.publicKey.toBase58() }

  /* ───────────────────────── hedef kontrolu ───────────────────────── */

  /**
   * Batch kurulmadan HEMEN once cagrilir.
   *
   * TOCTOU: kullanici bu kontrol ile submit arasinda ATA'sini dondurtebilir
   * (yalnizca USDC ihraccisi yapabilir). Pencereyi kapatamayiz, yalnizca
   * daraltiriz — ve kapatmaya gerek yok: dondurulmus hedefli transfer patlar,
   * batch'in TAMAMI basarisiz olur ve hicbir odeme yapilmaz. Yanlis
   * odemedense hicbir odeme dogrudur.
   */
  async validateDestinations(addresses: readonly string[]): Promise<readonly DestinationStatus[]> {
    const parsed = addresses.map((address) => {
      try {
        const owner = new PublicKey(address)
        return { address, owner, ata: getAssociatedTokenAddressSync(this.#mint, owner, true) }
      } catch {
        return { address, owner: null, ata: null }
      }
    })

    // Tek RPC turunda hem adresler hem ATA'lari. `null` = hesap zincirde yok
    // (gecerli bir yanit); RPC HATASI ise yukari atilir — "goremiyorum" ile
    // "yok" ayni sey degil, ikisini birlestirmek gecici bir kesinti yuzunden
    // gercek bir alacakliyi batch'ten dusurmek demek.
    const keys: PublicKey[] = []
    for (const p of parsed) if (p.owner && p.ata) keys.push(p.owner, p.ata)
    const infos = await this.#getMany(keys)

    let i = 0
    return parsed.map((p): DestinationStatus => {
      if (!p.owner || !p.ata) {
        return {
          address: p.address, onCurve: false, isTokenAccount: false, isMint: false,
          ataExists: false, ataFrozen: false,
        }
      }
      const addrInfo = infos[i++] ?? null
      const ataInfo = infos[i++] ?? null

      const ownedByToken = addrInfo?.owner.equals(TOKEN_PROGRAM_ID) === true
      const ata = ataInfo ? unpackAccount(p.ata, ataInfo) : null

      return {
        address: p.address,
        onCurve: PublicKey.isOnCurve(p.owner.toBytes()),
        // SPL Token: hesap 165 bayt, mint 82 bayt.
        isTokenAccount: ownedByToken && addrInfo!.data.length === 165,
        isMint: ownedByToken && addrInfo!.data.length === 82,
        ataExists: ata !== null,
        ataFrozen: ata?.isFrozen === true,
      }
    })
  }

  /** `getMultipleAccountsInfo` en fazla 100 anahtar alir. */
  async #getMany(keys: readonly PublicKey[]) {
    const out = []
    for (let i = 0; i < keys.length; i += 100) {
      out.push(...await this.#conn.getMultipleAccountsInfo(keys.slice(i, i + 100)))
    }
    return out
  }

  /* ───────────────────────── kaynak hesap ───────────────────────── */

  async sourceStatus(): Promise<SourceAccountStatus> {
    const payer = this.#payer.publicKey
    const sourceAta = getAssociatedTokenAddressSync(this.#mint, payer)

    const [lamports, rentMin, ataInfo] = await Promise.all([
      this.#conn.getBalance(payer),
      this.#conn.getMinimumBalanceForRentExemption(0),
      this.#conn.getAccountInfo(sourceAta),
    ])

    // Harcanabilir SOL = bakiye − kira muafiyeti asgarisi. Ham bakiyeyi
    // kullanmak yanlis olurdu: asgarinin altina dusen hesap islem yapamaz.
    const spendable = BigInt(lamports) - BigInt(rentMin)

    return {
      address: payer.toBase58(),
      usdcBalance: micros(ataInfo ? unpackAccount(sourceAta, ataInfo).amount : 0n),
      availableLamports: spendable < 0n ? 0n : spendable,
    }
  }

  /* ───────────────────────── gonderim ───────────────────────── */

  /** Kurar ve imzalar. Aga YAZMAZ — yalnizca blockhash ve hesap durumu icin okur. */
  async prepare(batch: PayoutBatch): Promise<SubmissionReceipt> {
    if (batch.items.length === 0) throw new Error('bos batch gonderilemez')

    const payer = this.#payer.publicKey
    const sourceAta = getAssociatedTokenAddressSync(this.#mint, payer)

    const dests = batch.items.map((it) => {
      const owner = new PublicKey(it.address)
      return { it, owner, ata: getAssociatedTokenAddressSync(this.#mint, owner, true) }
    })

    // Hangi ATA'lar eksik? Yalnizca onlar icin olusturma talimati eklenir —
    // her hedefe "idempotent olustur" koymak calisir ama transaction'i sisirir.
    const infos = await this.#getMany(dests.map((d) => d.ata))
    const missing = infos.map((x) => x === null)

    // §8 tuzak #7 — hangi item hangi talimatlarda. Bu esleme SUBMIT'TEN ONCE
    // sabitlenir ve kaydedilir. Sonradan yeniden turetmeye calismak, batch
    // basarisiz oldugunda kimin odendigini bilememek demek.
    const ixs: TransactionInstruction[] = []
    const opIndex: { publisherId: string; index: number }[] = []
    let cu = CU_BASE
    let ataCount = 0

    // Talimat 0 ve 1 butce; item'lar 2'den baslar.
    const BUDGET_IXS = 2
    dests.forEach((d, n) => {
      opIndex.push({ publisherId: d.it.publisherId, index: BUDGET_IXS + ixs.length })
      cu += CU_PER_TRANSFER
      if (missing[n]) {
        ixs.push(createAssociatedTokenAccountIdempotentInstruction(
          payer, d.ata, d.owner, this.#mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
        ))
        cu += CU_PER_ATA_CREATE
        ataCount++
      }
      ixs.push(createTransferCheckedInstruction(
        sourceAta, this.#mint, d.ata, payer,
        // Float'tan GECMEZ: defter tutari ile zincir tutari ayni tam sayidir.
        d.it.amount, USDC_DECIMALS, [], TOKEN_PROGRAM_ID,
      ))
    })

    const cuLimit = Math.min(cu, 1_400_000)
    const priority = this.cfg.priorityFeeMicroLamports ?? DEFAULT_PRIORITY_MICRO_LAMPORTS
    const budget = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priority }),
    ]

    const { blockhash, lastValidBlockHeight } = await this.#conn.getLatestBlockhash('confirmed')

    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: [...budget, ...ixs],
    }).compileToV0Message()

    const tx = new VersionedTransaction(message)
    tx.sign([this.#payer])

    const bytes = tx.serialize()
    if (bytes.length > MAX_TX_BYTES) {
      // Sessizce kirpmak yok: batch bolunmeden gonderilemez.
      throw new Error(
        `batch cok buyuk: ${bytes.length} bayt > ${MAX_TX_BYTES} ` +
        `(${batch.items.length} hedef, ${ataCount} yeni hesap) — batchSize dusur`,
      )
    }

    // Imza (kimlik) imzalandigi anda BILINIYOR. Kritik: "gonderdim ama cevap
    // gelmedi" durumunda bile ne aradigimizi biliyoruz.
    const sig = tx.signatures[0]
    if (!sig) throw new Error('transaction imzalanamadi')

    const priorityFee = (BigInt(cuLimit) * BigInt(priority) + 999_999n) / 1_000_000n
    return {
      batchId: batch.batchId,
      txHash: bs58.encode(sig),
      serializedTx: Buffer.from(bytes).toString('base64'),
      recentBlockhash: blockhash,
      lastValidBlockHeight,
      feeBid: BASE_FEE_LAMPORTS + priorityFee,
      opIndex,
    }
  }

  /**
   * Hazirlanmis transaction'i gonderir. AYNI byte'lar, her seferinde.
   *
   * Gonderim hatasi "odeme yapilmadi" DEMEK DEGIL: zaman asimi ya da baglanti
   * kopmasi, RPC transaction'i kabul ettikten SONRA da olabilir. Bu yuzden
   * belirsiz hatalar YUTULUYOR — karar `reconcile`'a, yani zincire birakiliyor.
   *
   * Yalnizca simulasyon transaction'in DETERMINISTIK olarak patlayacagini
   * soyledigi durumda hata firlatiliyor; o durumda odeme kesin olarak
   * yapilmadi ve guvenle iade edilebilir.
   */
  async send(receipt: SubmissionReceipt): Promise<void> {
    const bytes = Buffer.from(receipt.serializedTx, 'base64')
    try {
      await this.#conn.sendRawTransaction(bytes, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 0,
      })
    } catch (e) {
      // "Zaten islendi" IYI haber: onceki gonderim gecmis. `reconcile` gercegi
      // soyleyecek.
      if (isAlreadyProcessed(e)) return
      if (isDefinitelyRejected(e)) throw new SubmitRejected(receipt, describeError(e))
    }
  }

  /* ───────────────────────── mutabakat ───────────────────────── */

  /**
   * Zincire bakar ve TEK dogru cevabi verir.
   *
   * `err === null` ve kesinlesmis disindaki hicbir sey "odendi" degildir.
   * Zincire girmis ama patlamis bir transaction ucret keser, para gondermez.
   */
  async reconcile(receipt: SubmissionReceipt): Promise<SettlementResult> {
    // SIRA ONEMLI: once blok yuksekligi, SONRA durum. Ters siralamada, durum
    // sorgusu "yok" derken transaction tam o sirada dahil edilebilir ve biz
    // yuksekligi gecmis gorup olu ilan ederdik. Bu sirayla "yok" cevabi,
    // yukseklik gectikten SONRA alindigi icin kesindir.
    const height = await this.#conn.getBlockHeight(this.#settleAt)
    const { value } = await this.#conn.getSignatureStatuses([receipt.txHash], {
      searchTransactionHistory: true,
    })
    const st = value[0] ?? null

    if (st === null) {
      // Zincirde yok. Blockhash omru dolduysa bu transaction ARTIK ASLA
      // gecemez — yeni blockhash ile yeniden kurulabilir. Dolmadiysa bekle.
      const dead = height > receipt.lastValidBlockHeight
      return { state: dead ? 'expired' : 'pending', txHash: receipt.txHash, slot: null, feeCharged: null, opResults: [] }
    }

    const level = st.confirmationStatus ?? 'processed'
    const final = this.#settleAt === 'finalized'
      ? level === 'finalized'
      : level === 'confirmed' || level === 'finalized'

    // Henuz yeterince kesinlesmemis: `processed` bir fork'ta dusebilir.
    if (!final) {
      return { state: 'pending', txHash: receipt.txHash, slot: st.slot, feeCharged: null, opResults: [] }
    }

    const fee = await this.#feeOf(receipt.txHash)

    if (st.err === null) {
      return { state: 'settled', txHash: receipt.txHash, slot: st.slot, feeCharged: fee, opResults: [] }
    }
    return {
      state: 'failed', txHash: receipt.txHash, slot: st.slot, feeCharged: fee,
      opResults: failedOps(st.err, receipt),
    }
  }

  async #feeOf(sig: string): Promise<bigint | null> {
    try {
      const tx = await this.#conn.getTransaction(sig, {
        maxSupportedTransactionVersion: 0,
        commitment: this.#settleAt,
      })
      return tx?.meta ? BigInt(tx.meta.fee) : null
    } catch {
      // Ucret bilgisi teshis icindir; ana karar degismiyor.
      return null
    }
  }
}

/** Ag tarafindan KESIN olarak reddedilmis gonderim. Odeme yapilmadi. */
export class SubmitRejected extends Error {
  constructor(readonly receipt: SubmissionReceipt, message: string) {
    super(message)
    this.name = 'SubmitRejected'
  }
}

/* ───────────────────────── yardimcilar ───────────────────────── */

/**
 * Hangi item neden patladi.
 *
 * Solana yalniz ILK basarisiz talimati bildirir (`InstructionError[index, ...]`).
 * O indeksi, ait oldugu item'in ilk talimatina esliyoruz — ATA olusturma
 * talimati patlarsa da ayni publisher suclu sayilir.
 */
function failedOps(err: unknown, receipt: SubmissionReceipt): { index: number; code: string }[] {
  const ie = (err as { InstructionError?: [number, unknown] } | null)?.InstructionError
  if (!Array.isArray(ie)) return [{ index: -1, code: typeof err === 'string' ? err : JSON.stringify(err) }]

  const [ix, detail] = ie
  const starts = [...receipt.opIndex].sort((a, b) => a.index - b.index)
  let owner = starts[0]?.index ?? ix
  for (const s of starts) if (s.index <= ix) owner = s.index

  const code = typeof detail === 'string' ? detail : JSON.stringify(detail)
  return [{ index: owner, code }]
}

/**
 * Sicak cuzdan gizli anahtarini okur.
 *
 * Iki bicim: base58 (64 bayt, Phantom disa aktarma) veya JSON dizisi
 * (`solana-keygen` dosyasi). Hata mesajina DEGERI KOYMAYIZ.
 */
export function parseSecretKey(raw: string): Keypair {
  const s = raw.trim()
  try {
    const bytes = s.startsWith('[')
      ? Uint8Array.from(JSON.parse(s) as number[])
      : bs58.decode(s)
    return Keypair.fromSecretKey(bytes)
  } catch {
    throw new Error('sicak cuzdan anahtari okunamadi: base58 (64 bayt) veya JSON dizisi bekleniyor')
  }
}

function isAlreadyProcessed(e: unknown): boolean {
  return /already been processed|AlreadyProcessed/i.test(errText(e))
}

/**
 * Ag transaction'i KESIN reddetti mi?
 *
 * Ayrim hayati: reddedilmis bir transaction guvenle yeniden kurulabilir,
 * belirsiz olan KURULAMAZ. Belirsizi reddedilmis saymak cifte odeme demektir,
 * bu yuzden varsayilan "belirsiz" tarafinda.
 *
 * Kesin sayilan tek durum: preflight simulasyonu transaction'in bir
 * talimatinin PATLAYACAGINI soyluyor. `BlockhashNotFound` bilerek DEGIL — RPC
 * gecikmesinden de olabilir ve transaction aslinda gecerlidir.
 */
function isDefinitelyRejected(e: unknown): boolean {
  const t = errText(e)
  if (/BlockhashNotFound/i.test(t)) return false
  return /InstructionError|custom program error|insufficient funds|AccountNotFound|Simulation failed/i.test(t)
}

const errText = (e: unknown): string => {
  const logs = (e as { logs?: string[] } | null)?.logs
  return `${e instanceof Error ? e.message : String(e)} ${logs ? logs.join(' ') : ''}`
}

function describeError(e: unknown): string {
  return errText(e).trim().slice(0, 300)
}

/** Circle'in USDC mint'leri. §8 tuzak #8 — kendi token'imiz DEGIL. */
export const USDC_MINT = {
  devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
} as const satisfies Record<Network, string>

export const RPC_URL = {
  devnet: 'https://api.devnet.solana.com',
  mainnet: 'https://api.mainnet-beta.solana.com',
} as const satisfies Record<Network, string>

/** Tarayicida acilan linkler. Kullanici "nereye gitti?" diye bakabilsin. */
export const explorerTxUrl = (network: Network, signature: string): string =>
  `https://explorer.solana.com/tx/${signature}${network === 'devnet' ? '?cluster=devnet' : ''}`

export const explorerAccountUrl = (network: Network, address: string): string =>
  `https://explorer.solana.com/address/${address}${network === 'devnet' ? '?cluster=devnet' : ''}`

export const ATA_RENT_ESTIMATE_LAMPORTS = ATA_RENT_LAMPORTS
