/**
 * Reklamveren yatirma kaynagi — ADR-021.
 *
 * Solana'da "bu odemeyi kim yapti?" sorusu, islemin TOKEN BAKIYE FARKLARINDAN
 * cevaplanir: hazinemizin USDC hesabi artmis, baska bir sahibin USDC hesabi
 * azalmis. Azalan sahip gondericidir. Memo gerekmez — reklamveren de cuzdaniyla
 * giris yaptigi icin gonderen adres hesabin kimligiyle birebir ayni (ADR-010).
 *
 * Belirsiz durum (birden fazla gonderen, veya bir program araciligiyla gelen
 * para) `from: null` olarak doner: para hazinede DURUYOR, kaybolmadi, ama
 * kimin oldugunu bilmiyoruz — elle cozulur.
 */

import { Connection, PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'

export interface IncomingTransfer {
  readonly signature: string
  /** Gonderen cuzdan. Belirlenemediyse `null`. */
  readonly from: string | null
  /** Micro-USDC. */
  readonly amount: bigint
}

export interface IncomingBatch {
  /** ESKIDEN YENIYE. */
  readonly transfers: readonly IncomingTransfer[]
  /** Bir sonraki taramanin baslayacagi imza. */
  readonly newCursor: string | null
}

export interface DepositSource {
  /** `cursor`'dan SONRAKI, kesinlesmis ve BASARILI USDC girislerini dondurur. */
  incoming(cursor: string | null): Promise<IncomingBatch>
}

const PAGE = 1000
/** Ilk taramada bile sonsuza kadar geri gitme. */
const MAX_PAGES = 20

export class SolanaDepositSource implements DepositSource {
  readonly #conn: Connection
  readonly #treasury: PublicKey
  readonly #ata: PublicKey
  readonly #mint: string

  constructor(rpcUrl: string, treasuryOwner: string, usdcMint: string) {
    this.#conn = new Connection(rpcUrl, 'finalized')
    this.#treasury = new PublicKey(treasuryOwner)
    this.#mint = usdcMint
    this.#ata = getAssociatedTokenAddressSync(new PublicKey(usdcMint), this.#treasury)
  }

  async incoming(cursor: string | null): Promise<IncomingBatch> {
    // Yalnizca KESINLESMIS islemler: `confirmed` bir fork'ta dusebilir ve
    // kimsenin gondermedigi parayi deftere yazmak geri alinamaz bir hatadir.
    const sigs = []
    let before: string | undefined
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await this.#conn.getSignaturesForAddress(
        this.#ata,
        { limit: PAGE, ...(before ? { before } : {}), ...(cursor ? { until: cursor } : {}) },
        'finalized',
      )
      sigs.push(...page)
      if (page.length < PAGE) break
      before = page[page.length - 1]!.signature
    }
    if (sigs.length === 0) return { transfers: [], newCursor: cursor }

    // Liste YENIDEN ESKIYE gelir; en yeni imza yeni cursor olur.
    const newCursor = sigs[0]!.signature
    const transfers: IncomingTransfer[] = []

    for (const info of sigs.reverse()) {
      if (info.err !== null) continue   // basarisiz islemde para HAREKET ETMEDI
      const tx = await this.#conn.getParsedTransaction(info.signature, {
        commitment: 'finalized', maxSupportedTransactionVersion: 0,
      })
      if (!tx?.meta) continue

      const delta = new Map<string, bigint>()   // sahip → USDC degisimi
      const add = (owner: string | undefined, mint: string, amount: string, sign: 1n | -1n) => {
        if (!owner || mint !== this.#mint) return
        delta.set(owner, (delta.get(owner) ?? 0n) + sign * BigInt(amount))
      }
      for (const b of tx.meta.preTokenBalances ?? []) add(b.owner, b.mint, b.uiTokenAmount.amount, -1n)
      for (const b of tx.meta.postTokenBalances ?? []) add(b.owner, b.mint, b.uiTokenAmount.amount, 1n)

      const received = delta.get(this.#treasury.toBase58()) ?? 0n
      if (received <= 0n) continue          // bize gelen bir para degil

      const senders = [...delta.entries()].filter(([o, d]) => d < 0n && o !== this.#treasury.toBase58())
      transfers.push({
        signature: info.signature,
        from: senders.length === 1 ? senders[0]![0] : null,
        amount: received,
      })
    }

    return { transfers, newCursor }
  }
}
