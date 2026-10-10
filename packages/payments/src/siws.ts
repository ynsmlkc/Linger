/**
 * Cuzdanla giris imzasi — Sign-In With Solana (SIWS) bicimi — ADR-014.
 *
 * Kullanicinin bir adresi kontrol ettigini ispatlamanin yolu: sunucunun urettigi
 * OKUNABILIR bir mesaji cuzdaniyla imzalamak. Cuzdan (Phantom, Solflare,
 * Backpack) `signMessage` ile yalnizca mesaj imzalar; bu bir transaction
 * DEGILDIR ve aga gonderilemez. Guvenlik bu ayrimdan gelir.
 *
 * Neden ham byte degil de yapili mesaj:
 *   1. Cuzdan mesaji kullaniciya gosterir: "linger.example sitesine giris" —
 *      kullanici neyi imzaladigini okuyabilir.
 *   2. Alan adi mesajin icinde: baska bir sitenin imzalattigi mesaj burada
 *      gecmez (phishing savunmasi).
 *   3. Sunucunun sectigi ham byte'lari imzalatmak bir "signing oracle"dir:
 *      ele gecirilmis bir sunucu challenge yerine gercek bir transfer
 *      transaction'inin mesajini gonderip cuzdani bosaltabilir. Yapili metin
 *      bunu engeller: transaction mesaji kucuk sayilarla baslayan bir
 *      basliktir, bizim mesajimiz yazdirilabilir ASCII — ve cuzdanlar
 *      transaction gibi gorunen byte'lari `signMessage` ile imzalamayi
 *      reddeder.
 *
 * SINIR: Solana'da tek bir ed25519 anahtar = tek cuzdan. Multisig kasalar
 * (Squads vb.) mesaj imzalayamaz; onlar zaten `checkAddress` tarafinda PDA
 * olarak reddediliyor.
 *
 * DIKKAT: imza ispati hesap ele gecirmeyi ENGELLEMEZ. Saldirgan kendi
 * cuzdaniyla imzalar ve dogrulama sorunsuz gecer. Imza yalnizca "hedef adresin
 * sahibi bu istegi yapti" der. Tek savunma bekleme suresi ve bildirimdir
 * (bkz. wallet.ts).
 */

import { createPublicKey, verify as edVerify } from 'node:crypto'
import { PublicKey } from '@solana/web3.js'
import type { Clock, IdGenerator } from '@linger/protocol'
import type { Network } from './wallet.js'

export interface SiwsConfig {
  /** Sunucunun herkese acik alan adi. Mesajin icinde imzalanir. */
  readonly domain: string
  readonly network: Network
  /** Challenge omru. Kisa tutulur — replay penceresini daraltir. */
  readonly ttlSec?: number
}

export interface ChallengeResult {
  /** Cuzdana imzalatilacak, OKUNABILIR mesaj. */
  readonly message: string
  readonly expiresAt: number
}

export type VerifyFailure =
  | 'gecersiz_adres'
  | 'gecersiz_imza'
  | 'mesaj_uyusmuyor'
  | 'suresi_dolmus'

export type VerifyResult =
  | { readonly ok: true; readonly account: string }
  | { readonly ok: false; readonly reason: VerifyFailure; readonly detail: string }

export const DEFAULT_TTL_SEC = 300

/** Mesajin ilk satirindan sonra gelen sabit ifade. */
const STATEMENT =
  'Linger hesabina giris yapiyorsun. Bu bir islem degildir, ucret dogurmaz ve cuzdanindan para cikmaz.'

/** Ed25519 acik anahtarini DER (SPKI) icine saran sabit onek. */
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export class Siws {
  constructor(
    private readonly cfg: SiwsConfig,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /** Adres icin mesaj uretir. Mesaj submit EDILEMEZ — transaction degil. */
  challenge(address: string): ChallengeResult {
    const ttl = this.cfg.ttlSec ?? DEFAULT_TTL_SEC
    const now = this.clock.now()
    const expiresAt = now + ttl * 1000

    const message = [
      `${this.cfg.domain} bu Solana hesabiyla giris yapmani istiyor:`,
      address,
      '',
      STATEMENT,
      '',
      `URI: https://${this.cfg.domain}`,
      'Version: 1',
      `Chain: ${this.cfg.network}`,
      `Nonce: ${this.ids.randomHex(16)}`,
      `Issued At: ${new Date(now).toISOString()}`,
      `Expiration Time: ${new Date(expiresAt).toISOString()}`,
    ].join('\n')

    return { message, expiresAt }
  }

  /**
   * Imzayi dogrular.
   *
   * `issuedMessage` sunucunun bu adres icin URETTIGI mesajdir (WalletAuth
   * bellekte tutar). Istemcinin gonderdigi mesaja GUVENILMEZ: yalnizca
   * birebir ayni ise kabul edilir, aksi halde istemci kendi sectigi bir metni
   * imzalatip gecirebilirdi.
   */
  verify(
    address: string,
    issuedMessage: string,
    signedMessage: string,
    signatureBase64: string,
  ): VerifyResult {
    if (signedMessage !== issuedMessage) {
      return { ok: false, reason: 'mesaj_uyusmuyor', detail: 'imzalanan mesaj uretilen mesaj degil' }
    }

    const expires = /^Expiration Time: (.+)$/m.exec(issuedMessage)?.[1]
    if (!expires || Date.parse(expires) < this.clock.now()) {
      return { ok: false, reason: 'suresi_dolmus', detail: 'challenge suresi dolmus' }
    }

    let pub: Uint8Array
    try {
      pub = new PublicKey(address).toBytes()
    } catch {
      return { ok: false, reason: 'gecersiz_adres', detail: address }
    }

    const sig = Buffer.from(signatureBase64, 'base64')
    if (sig.length !== 64) {
      return { ok: false, reason: 'gecersiz_imza', detail: `imza 64 bayt olmali, gelen ${sig.length}` }
    }

    let ok = false
    try {
      const key = createPublicKey({
        key: Buffer.concat([SPKI_ED25519_PREFIX, pub]),
        format: 'der',
        type: 'spki',
      })
      ok = edVerify(null, Buffer.from(signedMessage, 'utf8'), key, sig)
    } catch (e) {
      return { ok: false, reason: 'gecersiz_imza', detail: e instanceof Error ? e.message : String(e) }
    }

    return ok
      ? { ok: true, account: address }
      : { ok: false, reason: 'gecersiz_imza', detail: 'ed25519 dogrulamasi basarisiz' }
  }
}
