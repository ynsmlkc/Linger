/**
 * Hedef adres dogrulamasi — ADR-020.
 *
 * Zincir ustu odeme GERI ALINAMAZ. Yanlis adrese giden para gitmistir.
 * Bu yuzden kontrollerin hepsi gecilmeden adres baglanmaz.
 *
 * Kontroller iki gruba ayriliyor:
 *   • Bicimsel — ag erisimi gerektirmez, aninda calisir
 *   • Zincir ustu — token hesabi mi, mint mi, ATA dondurulmus mu
 *
 * Alicinin USDC ATA'sini GONDEREN acar. Bu yuzden ATA'nin bulunmamasi red
 * sebebi degil.
 */

import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'

export type AddressRejection =
  | 'gecersiz_bicim'
  | 'secret_key'
  | 'desteklenmeyen_tip_pda'
  | 'token_hesabi'
  | 'mint_adresi'
  | 'ata_dondurulmus'
  | 'baska_hesaba_bagli'

export interface AddressCheck {
  readonly ok: boolean
  readonly reason: AddressRejection | null
  /** Kullaniciya gosterilecek tek cumle. */
  readonly message: string | null
  /** Kullanicinin ne yapmasi gerektigi. */
  readonly hint: string | null
}

const OK: AddressCheck = { ok: true, reason: null, message: null, hint: null }
const fail = (reason: AddressRejection, message: string, hint?: string): AddressCheck =>
  ({ ok: false, reason, message, hint: hint ?? null })

const SECRET_HINT =
  'Ekrana veya bir dosyaya yapistirdiysan o cuzdani ARTIK KULLANMA. ' +
  'Yeni bir cuzdan olustur ve ACIK adresini (kisa, 32-44 karakter) gir.'

/**
 * Yapistirilan sey gizli anahtar veya kurtarma ifadesi mi?
 *
 * Gorunum bicimleri:
 *   • Phantom / Solflare "private key" disa aktarma → 64 bayt, base58 (~88 karakter)
 *   • Solana CLI keypair dosyasi → `[12,34,...]` 64 sayilik JSON dizisi
 *   • Kurtarma ifadesi → 12 veya 24 kucuk harfli kelime
 *
 * 32 baytlik ham tohum base58'de acik adresle AYNI gorunur; onu ayirt etmenin
 * yolu yok — bu yuzden yalnizca ayirt edilebilenler burada yakalaniyor.
 */
function looksLikeSecret(raw: string): boolean {
  if (raw.startsWith('[') && raw.endsWith(']')) {
    try {
      const arr: unknown = JSON.parse(raw)
      if (Array.isArray(arr) && arr.length === 64 && arr.every((n) => Number.isInteger(n) && n >= 0 && n < 256)) {
        return true
      }
    } catch { /* JSON degil */ }
  }

  const words = raw.split(/\s+/)
  if ((words.length === 12 || words.length === 24) && words.every((w) => /^[a-z]{3,8}$/.test(w))) {
    return true
  }

  if (raw.length >= 80 && raw.length <= 90) {
    try { if (bs58.decode(raw).length === 64) return true } catch { /* base58 degil */ }
  }
  return false
}

/**
 * Bicimsel kontroller — ag erisimi YOK.
 *
 * Ayri durmasinin sebebi: kullanici adresi yazarken aninda geri bildirim
 * verebilmek ve zincire gereksiz sorgu atmamak.
 */
export function checkAddressFormat(raw: string): AddressCheck {
  const address = raw.trim()

  // EN ONEMLI KONTROL, EN BASTA.
  //
  // Kullanici kazara gizli anahtar veya kurtarma ifadesi yapistirabilir. Bu
  // durumda:
  //   • hemen dur
  //   • degeri EKRANA BASMA
  //   • LOG'A YAZMA
  //   • hata mesajina KOYMA
  // Anahtar bir kez bir yere yazildiginda geri alinamaz.
  if (looksLikeSecret(address)) {
    return fail('secret_key', 'Bu bir GIZLI ANAHTAR veya kurtarma ifadesi. Adres degil.', SECRET_HINT)
  }

  let key: PublicKey
  try {
    key = new PublicKey(address)
  } catch {
    return fail('gecersiz_bicim',
      'Gecerli bir Solana adresi degil.',
      'Adres 32-44 karakterlik base58 metindir (0, O, I, l harflerini icermez).')
  }

  // Egri disi adresler PDA'dir — bir program sahibidir, bir insan degil.
  // USDC'yi buraya gondermek mumkun ama cekmenin yolu programin koduna baglidir;
  // cogu durumda para kalici olarak kilitlenir.
  if (!PublicKey.isOnCurve(key.toBytes())) {
    return fail('desteklenmeyen_tip_pda',
      'Program hesaplari (PDA) ve multisig kasalari henuz desteklenmiyor.',
      'Phantom, Solflare veya Backpack gibi bir cuzdanin kendi adresini gir.')
  }

  return OK
}

/** Zincirden okunan hesap durumu. `PaymentRail` doldurur. */
export interface OnChainAccount {
  /** Adres bir token hesabinin kendisi mi? */
  readonly isTokenAccount: boolean
  /** Adres bir mint mi? */
  readonly isMint: boolean
  /** Adresin USDC ATA'si. Yoksa `exists: false` — odeme sirasinda olusturulur. */
  readonly ata: { readonly exists: boolean; readonly frozen: boolean }
}

export interface OnChainCheckInput {
  readonly address: string
  readonly account: OnChainAccount
  /** USDC mint adresi. */
  readonly usdcMint: string
  /** Adres baska bir publisher'a bagli mi? */
  readonly boundToOther: boolean
}

/** Zincir ustu kontroller — ADR-020 tablosunun 3-6. maddeleri. */
export function checkAddressOnChain(input: OnChainCheckInput): AddressCheck {
  const { address, account } = input

  // Mint adresine "odeme" ATA olusturamaz ve islem patlar; yine de kullaniciya
  // dogru sebebi soylemek icin ayri yakalanir.
  if (address === input.usdcMint || account.isMint) {
    return fail('mint_adresi',
      'Bu adres bir token mint adresi, cuzdan degil.',
      'Cuzdaninin kendi adresini gir.')
  }

  if (input.boundToOther) {
    // Ayni adresin N hesaba baglanabilmesi ADR-010'un sybil savunmasinda delik:
    // 500 GitHub hesabi tek cuzdana odeme yapabilirdi.
    return fail('baska_hesaba_bagli',
      'Bu adres baska bir Linger hesabina bagli.',
      'Her adres yalnizca bir hesaba baglanabilir.')
  }

  if (account.isTokenAccount) {
    // En sik yapilan hata: cuzdan yerine USDC token hesabinin adresini
    // kopyalamak. Para o hesaba gider ama cuzdanin sahibi degisir ve bazi
    // cuzdanlar bu adresi hic gostermez.
    return fail('token_hesabi',
      'Bu adres bir token hesabi. Cuzdan adresi degil.',
      'Cuzdaninin ana adresini kopyala — USDC hesabini bizim icin o adresten turetiriz.')
  }

  if (account.ata.exists && account.ata.frozen) {
    // Dondurulmus hesaba transfer patlar ve TUM batch'i dusurur.
    return fail('ata_dondurulmus',
      'Bu adresteki USDC hesabi dondurulmus.',
      'USDC ihraccisi hesabi dondurmus. Baska bir adres dene.')
  }

  return OK
}

/** Iki asamayi birlestirir. */
export function checkAddress(input: OnChainCheckInput): AddressCheck {
  const format = checkAddressFormat(input.address)
  return format.ok ? checkAddressOnChain(input) : format
}

/** Kullaniciya gosterilirken adresi kisalt. Tam hali kopyalanabilir kalmali. */
export const shortAddress = (a: string): string =>
  a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
