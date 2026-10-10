/**
 * Odeme rayi — §6.4.
 *
 * Solana'ya dokunan her sey bu arayuzun arkasinda. Sebebi test edilebilirlik:
 * `payments` her zaman mock rail ile birim test edilir, devnet yalnizca ayri
 * bir entegrasyon suite'inde kullanilir (§11).
 */

import type { Micros } from '@linger/protocol'

/**
 * Hedef adresin zincirdeki durumu.
 *
 * Alici cuzdanin USDC almasi icin bir ATA (associated token account)
 * gerekir ve ATA'yi GONDEREN acabilir. Yani ATA'nin
 * olmamasi engel degil, yalnizca ilk odemede kucuk bir kira maliyeti demek.
 * Engel olanlar: cuzdan olmayan adresler ve dondurulmus token hesaplari.
 */
export interface DestinationStatus {
  readonly address: string
  /** Adres ed25519 egrisi uzerinde mi? PDA / program hesabi ise `false`. */
  readonly onCurve: boolean
  /** Adres kendisi bir token hesabi mi? (Cuzdan yerine ATA yapistirilmis.) */
  readonly isTokenAccount: boolean
  /** Adres USDC mint'inin kendisi mi? */
  readonly isMint: boolean
  /** USDC ATA'si zincirde var mi? Yoksa odeme sirasinda olusturulur. */
  readonly ataExists: boolean
  /** ATA var ama dondurulmus (USDC ihraccisi dondurabilir). */
  readonly ataFrozen: boolean
}

export interface PayoutItem {
  readonly publisherId: string
  readonly address: string
  readonly amount: Micros
}

export interface PayoutBatch {
  readonly batchId: string
  readonly items: readonly PayoutItem[]
}

/**
 * Submit sonucu.
 *
 * `txHash` (Solana'da: ilk imza, base58) submit'ten ONCE biliniyor: transaction
 * imzalandigi anda kimligi belli. Bu yuzden "submit ettim ama cevap gelmedi"
 * durumunda bile mutabakat kurulabilir.
 */
export interface SubmissionReceipt {
  readonly batchId: string
  readonly txHash: string
  /** ADR §8 tuzak #9 — retry AYNI byte'lari gonderir, yeniden insa etmez. */
  readonly serializedTx: string
  readonly recentBlockhash: string
  /** Bu blok yuksekligini asan transaction kesin olarak olu sayilir. */
  readonly lastValidBlockHeight: number
  /** Toplam ucret teklifi (lamport): taban + oncelik. Yalnizca teshis icin. */
  readonly feeBid: bigint
  /** Hangi item hangi transfer sirasinda — §8 tuzak #7. */
  readonly opIndex: readonly { publisherId: string; index: number }[]
}

export type SettlementState =
  /** Zincirde, `err === null` ve kesinlesmis. Tek dogru "odendi" tanimi. */
  | 'settled'
  /** Zincire girdi ama `err !== null`. Ucret kesildi, para gitmedi. */
  | 'failed'
  /** Henuz kesinlesmedi. Blockhash gecerliyse AYNI transaction tekrar gonderilir. */
  | 'pending'
  /** Blockhash omru doldu ve hala yok. Ancak SIMDI yeni blockhash ile yeniden kurulur. */
  | 'expired'

export interface SettlementResult {
  readonly state: SettlementState
  readonly txHash: string
  readonly slot: number | null
  readonly feeCharged: bigint | null
  /** Basarisizsa hangi transfer neden patladi. */
  readonly opResults: readonly { index: number; code: string }[]
}

export interface SourceAccountStatus {
  readonly address: string
  readonly usdcBalance: Micros
  /**
   * Harcanabilir SOL (lamport) — kira muafiyeti asgarisi dusulmus.
   *
   * USDC'si dolu ama SOL'u biten payout hesabi SESSIZCE DURUR ve USDC
   * alarmi susar; islem ucretini de, alicilar icin acilan ATA kiralarini da
   * SOL oder. Bu yuzden ayri izlenir (§8 tuzak #11).
   */
  readonly availableLamports: bigint
}

export interface PaymentRail {
  /** Batch kurulmadan HEMEN once cagrilir — TOCTOU penceresi dar tutulur. */
  validateDestinations(addresses: readonly string[]): Promise<readonly DestinationStatus[]>
  sourceStatus(): Promise<SourceAccountStatus>

  /**
   * Transaction'i kurar ve IMZALAR — aga hicbir sey YAZMAZ.
   *
   * Kurmak ile gondermek bilincli olarak ayri. Tek bir `submitBatch` cagrisi
   * olsaydi, cagiran defterine ancak gonderimden SONRA yazabilirdi; arada
   * dusen bir sunucu parayi zincirde gonderilmis ama defterde hala odenebilir
   * birakirdi — yani ayni para ikinci kez odenirdi.
   *
   * Bu ayrimla imza (kimlik) gonderimden ONCE biliniyor: ne olursa olsun
   * neye bakacagimizi biliyoruz.
   */
  prepare(batch: PayoutBatch): Promise<SubmissionReceipt>

  /**
   * Hazirlanmis transaction'i aga gonderir.
   *
   * AYNI byte'lar. Tekrar cagrilabilir: ag ayni imzayi ikinci kez uygulamaz,
   * dolayisiyla idempotenttir. Yeniden insa etmek bunu bozar.
   */
  send(receipt: SubmissionReceipt): Promise<void>

  /**
   * Zincire bakar ve TEK dogru cevabi verir. `expired` kararini da rail
   * verir (blok yuksekligi karsilastirmasi) — cagiran saat karsilastirmaz.
   */
  reconcile(receipt: SubmissionReceipt): Promise<SettlementResult>
}
