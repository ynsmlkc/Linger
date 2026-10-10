/**
 * ADR-020 — hedef adres dogrulamasi.
 *
 * Gercek Solana anahtarlariyla: uydurma adres, "gecerli gorunen" ama yanlis
 * adresleri yakalamaz.
 */

import { describe, it, expect } from 'vitest'
import { Keypair, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import {
  checkAddress, checkAddressFormat, checkAddressOnChain, shortAddress,
  type OnChainAccount, type OnChainCheckInput,
} from '../src/address.js'

const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
const WALLET = Keypair.generate().publicKey.toBase58()

const healthy: OnChainAccount = {
  isTokenAccount: false, isMint: false, ata: { exists: true, frozen: false },
}
const input = (over: Partial<OnChainCheckInput> = {}, account: Partial<OnChainAccount> = {}): OnChainCheckInput => ({
  address: WALLET, usdcMint: MINT, boundToOther: false,
  account: { ...healthy, ...account },
  ...over,
})

describe('bicimsel kontroller', () => {
  it('gecerli cuzdan adresi gecer', () => {
    expect(checkAddressFormat(WALLET).ok).toBe(true)
  })

  it('bastaki ve sondaki bosluklari temizler', () => {
    expect(checkAddressFormat(`  ${WALLET}\n`).ok).toBe(true)
  })

  for (const bad of ['', 'abc', 'O0Il' + 'A'.repeat(40), 'GABC', 'x'.repeat(50)]) {
    it(`bozuk adres reddedilir: "${bad.slice(0, 12)}"`, () => {
      const r = checkAddressFormat(bad)
      expect(r.ok).toBe(false)
      expect(r.reason).toBe('gecersiz_bicim')
    })
  }

  it('PDA (egri disi) adresi reddedilir', () => {
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from('vault')], new PublicKey(MINT))
    const r = checkAddressFormat(pda.toBase58())
    expect(r.reason).toBe('desteklenmeyen_tip_pda')
  })
})

describe('gizli anahtar korumasi — EN ONEMLI KONTROL', () => {
  const kp = Keypair.generate()

  it('base58 64 bayt (Phantom disa aktarma) yakalanir', () => {
    expect(checkAddressFormat(bs58.encode(kp.secretKey)).reason).toBe('secret_key')
  })

  it('JSON dizisi (solana-keygen dosyasi) yakalanir', () => {
    expect(checkAddressFormat(JSON.stringify([...kp.secretKey])).reason).toBe('secret_key')
  })

  it('12 kelimelik kurtarma ifadesi yakalanir', () => {
    const phrase = 'legal winner thank year wave sausage worth useful legal winner thank yellow'
    expect(checkAddressFormat(phrase).reason).toBe('secret_key')
  })

  it('mesaj ve ipucu anahtarin KENDISINI icermez', () => {
    const secret = bs58.encode(kp.secretKey)
    const r = checkAddressFormat(secret)
    expect(JSON.stringify(r)).not.toContain(secret.slice(0, 16))
    expect(r.hint).toMatch(/KULLANMA/)
  })

  it('acik adres gizli anahtar sanilmaz', () => {
    expect(checkAddressFormat(kp.publicKey.toBase58()).ok).toBe(true)
  })
})

describe('zincir ustu kontroller', () => {
  it('saglikli cuzdan gecer', () => {
    expect(checkAddressOnChain(input()).ok).toBe(true)
  })

  it('ATA olmayan cuzdan da gecer — gonderen olusturur', () => {
    const r = checkAddressOnChain(input({}, { ata: { exists: false, frozen: false } }))
    expect(r.ok, 'ATA yoklugu engel degil').toBe(true)
  })

  it('token hesabi adresi (cuzdan yerine ATA yapistirilmis) reddedilir', () => {
    const r = checkAddressOnChain(input({}, { isTokenAccount: true }))
    expect(r.reason).toBe('token_hesabi')
    expect(r.hint).toMatch(/ana adres/)
  })

  it('mint adresi reddedilir', () => {
    expect(checkAddressOnChain(input({ address: MINT })).reason).toBe('mint_adresi')
    expect(checkAddressOnChain(input({}, { isMint: true })).reason).toBe('mint_adresi')
  })

  it('dondurulmus ATA reddedilir', () => {
    const r = checkAddressOnChain(input({}, { ata: { exists: true, frozen: true } }))
    expect(r.reason).toBe('ata_dondurulmus')
  })

  it('baska hesaba bagli adres reddedilir — sybil savunmasi', () => {
    expect(checkAddressOnChain(input({ boundToOther: true })).reason).toBe('baska_hesaba_bagli')
  })
})

describe('checkAddress — iki asamayi birlestirir', () => {
  it('bicim bozuksa zincire hic bakmaz', () => {
    const r = checkAddress(input({ address: 'bozuk' }, { isTokenAccount: true }))
    expect(r.reason, 'ilk hata bicimden gelmeli').toBe('gecersiz_bicim')
  })

  it('bicim gecerse zincir ustu kontrol calisir', () => {
    expect(checkAddress(input({}, { isTokenAccount: true })).reason).toBe('token_hesabi')
    expect(checkAddress(input()).ok).toBe(true)
  })
})

describe('shortAddress', () => {
  it('uzun adresi kisaltir', () => {
    expect(shortAddress(WALLET)).toBe(`${WALLET.slice(0, 6)}…${WALLET.slice(-4)}`)
  })
  it('kisa metne dokunmaz', () => {
    expect(shortAddress('abc')).toBe('abc')
  })
})
