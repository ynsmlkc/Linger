/**
 * Cuzdanla giris — ADR-010 (2026-08-15 revizyonu), ADR-014.
 *
 * Akis:
 *   1. Istemci adresini verir       → sunucu SIWS mesaji uretir
 *   2. Kullanici cuzdaniyla imzalar → sunucu dogrular
 *   3. Sunucu device token uretir   → istemci onu saklar
 *
 * Mesaj bir transaction DEGILDIR; aga HICBIR ZAMAN gonderilemez. Guvenlik
 * yapinin kendisinden gelir, bizim dikkatimizden degil (ADR-014).
 *
 * `publisherId` adresin KENDISIDIR. Ayri bir kullanici tablosu yok:
 * kimlik ile odeme hedefi ayni sey, ikisini ayirmak gereksiz bir eslesme
 * katmani yaratirdi.
 */

import { Siws, checkAddressFormat } from '@linger/payments'
import type { Clock, IdGenerator, TokenScope } from '@linger/protocol'

export interface PendingChallenge {
  readonly address: string
  readonly message: string
  readonly expiresAt: number
  consumed: boolean
}

export interface WalletAuthDeps {
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly siws: Siws
  /** Uretilen token'i saklar; ham token DEGIL, hash'i saklanir. */
  readonly issueToken: (input: {
    publisherId: string
    tokenHash: string
    scopes: readonly TokenScope[]
    role: Role
  }) => { tokenId: string }
  readonly hashToken: (raw: string) => string
}

/**
 * Rol basina kapsamlar.
 *
 * Ayni cuzdan hem yayinci hem reklamveren olabilir — ama AYNI ANDA DEGIL,
 * ayni token'la degil. Iki ayri giris, iki ayri token.
 *
 * Sebep: kapsam karistirmak, calinmis bir daemon token'inin kampanya
 * olusturup butce harcamasi demek. Daemon her makinede duruyor; panel
 * token'i yalnizca tarayicida.
 */
export type Role = 'publisher' | 'advertiser'

export const SCOPES_BY_ROLE: Record<Role, readonly TokenScope[]> = {
  publisher: ['report:impressions', 'read:balance', 'withdraw:balance'],
  advertiser: ['manage:campaigns', 'read:spend'],
}

/** Geriye donuk ad. */
export const LOGIN_SCOPES = SCOPES_BY_ROLE.publisher

export type ChallengeResult =
  | { readonly ok: true; readonly message: string; readonly expiresAt: number }
  | { readonly ok: false; readonly reason: string }

export type LoginResult =
  | { readonly ok: true; readonly token: string; readonly tokenId: string; readonly publisherId: string }
  | { readonly ok: false; readonly reason: string; readonly detail?: string }

export class WalletAuth {
  readonly #pending = new Map<string, PendingChallenge>()

  constructor(private readonly deps: WalletAuthDeps) {}

  /** Adres icin challenge uretir. */
  challenge(address: string): ChallengeResult {
    // ADR-020: yalnizca gercek bir cuzdan adresi. PDA'lar burada da reddedilir
    // — kimlik ile odeme hedefi ayni sey oldugu icin ayni kurallar gecerli.
    // Gizli anahtar yapistirilmissa DEGERI hata mesajina KONMAZ.
    const format = checkAddressFormat(address)
    if (!format.ok) return { ok: false, reason: format.message ?? 'gecersiz Solana adresi' }

    const c = this.deps.siws.challenge(address)
    this.#pending.set(address, { address, message: c.message, expiresAt: c.expiresAt, consumed: false })
    this.#gc()
    return { ok: true, message: c.message, expiresAt: c.expiresAt }
  }

  /** Imzalanmis challenge'i dogrular ve token uretir. */
  async verify(
    address: string,
    signedMessage: string,
    signatureBase64: string,
    role: Role = 'publisher',
  ): Promise<LoginResult> {
    const pending = this.#pending.get(address)
    if (!pending) return { ok: false, reason: 'challenge bulunamadi — once /v1/auth/challenge' }

    // Tek kullanimlik: ayni imzayi ikinci kez gondermek yeni token uretemez.
    if (pending.consumed) return { ok: false, reason: 'challenge zaten kullanilmis' }
    if (pending.expiresAt < this.deps.clock.now()) {
      this.#pending.delete(address)
      return { ok: false, reason: 'challenge suresi dolmus' }
    }

    // Sunucunun URETTIGI mesaj ile istemcinin imzaladigi mesaj birebir ayni
    // olmali; istemcinin kendi sectigi bir metin gecmez.
    const result = this.deps.siws.verify(address, pending.message, signedMessage, signatureBase64)
    if (!result.ok) {
      return { ok: false, reason: 'imza dogrulanamadi', detail: result.reason }
    }

    pending.consumed = true
    this.#pending.delete(address)

    // Ham token YALNIZCA burada, bir kez gorunur. Sunucu hash'ini saklar.
    const raw = `lng_${this.deps.ids.randomHex(24)}`
    const { tokenId } = this.deps.issueToken({
      publisherId: address,
      tokenHash: this.deps.hashToken(raw),
      scopes: SCOPES_BY_ROLE[role],
      role,
    })

    return { ok: true, token: raw, tokenId, publisherId: address }
  }

  /** Suresi dolmus challenge'lari at — bellek sinirsiz buyumesin. */
  #gc(): void {
    const now = this.deps.clock.now()
    for (const [k, v] of this.#pending) {
      if (v.expiresAt < now - 60_000) this.#pending.delete(k)
    }
  }

  pendingCount(): number { return this.#pending.size }
}
