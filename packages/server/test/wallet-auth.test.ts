/**
 * Cuzdanla giris — ADR-010 (revize).
 *
 * Buradaki testlerin cogu "mutlu yol"u degil, REDDI kontrol ediyor: bir giris
 * sisteminde hata, yanlis kisiyi iceri almaktir. Dogru kisiyi iceri almamak
 * can sikici; yanlis kisiyi almak geri alinamaz.
 *
 * Imzalar gercek ed25519: cuzdanin `signMessage` ile yaptigi seyin ayni.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Keypair, PublicKey } from '@solana/web3.js'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { Siws } from '@linger/payments'
import { fixedClock, cryptoIdGenerator } from '@linger/protocol'
import { WalletAuth, LOGIN_SCOPES } from '../src/http/wallet-auth.js'
import { hashToken } from '../src/http/auth.js'

const HOME = 'linger.test'

function setup(now = 1_700_000_000_000) {
  const issued: { publisherId: string; tokenHash: string }[] = []
  const clock = fixedClock(now)
  const ids = cryptoIdGenerator(clock)
  const auth = new WalletAuth({
    clock, ids,
    siws: new Siws({ domain: HOME, network: 'devnet' }, clock, ids),
    hashToken,
    issueToken: (i) => {
      issued.push({ publisherId: i.publisherId, tokenHash: i.tokenHash })
      return { tokenId: `tok-${issued.length}` }
    },
  })
  return { auth, issued, clock }
}

/** Kullanicinin cuzdaninin yapacagi: mesaji imzala, base64 dondur. */
const sign = (message: string, kp: Keypair): string =>
  Buffer.from(nacl.sign.detached(Buffer.from(message, 'utf8'), kp.secretKey)).toString('base64')

describe('WalletAuth', () => {
  let user: Keypair
  let addr: string
  beforeEach(() => { user = Keypair.generate(); addr = user.publicKey.toBase58() })

  it('gecerli imza token uretir ve publisherId adresin kendisidir', async () => {
    const { auth, issued } = setup()
    const c = auth.challenge(addr)
    expect(c.ok).toBe(true)
    if (!c.ok) return

    const r = await auth.verify(addr, c.message, sign(c.message, user))
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // Kimlik = adres. Ayri bir kullanici kimligi yok (ADR-010 revize).
    expect(r.publisherId).toBe(addr)
    expect(issued[0]!.publisherId).toBe(addr)
  })

  it('ham token sunucuda SAKLANMAZ — yalnizca hash', async () => {
    const { auth, issued } = setup()
    const c = auth.challenge(addr)
    if (!c.ok) return
    const r = await auth.verify(addr, c.message, sign(c.message, user))
    if (!r.ok) return

    expect(issued[0]!.tokenHash).toBe(hashToken(r.token))
    expect(issued[0]!.tokenHash).not.toContain(r.token)
  })

  it('token yalnizca daemon kapsamlarini tasir — cuzdan degistiremez', async () => {
    expect(LOGIN_SCOPES).toEqual(['report:impressions', 'read:balance', 'withdraw:balance'])
    expect(LOGIN_SCOPES).not.toContain('manage:wallet')
  })

  it('BASKASININ anahtariyla imzalanan challenge reddedilir', async () => {
    const { auth, issued } = setup()
    const c = auth.challenge(addr)
    if (!c.ok) return

    // Saldirgan kendi anahtariyla imzaliyor, ama kurbanin adresini iddia ediyor.
    const r = await auth.verify(addr, c.message, sign(c.message, Keypair.generate()))
    expect(r.ok).toBe(false)
    expect(issued).toHaveLength(0)
  })

  it('bos veya bozuk imza reddedilir', async () => {
    const { auth } = setup()
    const c = auth.challenge(addr)
    if (!c.ok) return
    expect((await auth.verify(addr, c.message, '')).ok).toBe(false)
    expect((await auth.verify(addr, c.message, Buffer.from('kisa').toString('base64'))).ok).toBe(false)
  })

  it('istemcinin degistirdigi mesaj reddedilir — imza gecerli olsa bile', async () => {
    const { auth, issued } = setup()
    const c = auth.challenge(addr)
    if (!c.ok) return
    const kurcalanmis = c.message.replace('devnet', 'mainnet')
    const r = await auth.verify(addr, kurcalanmis, sign(kurcalanmis, user))
    expect(r.ok).toBe(false)
    expect(issued).toHaveLength(0)
  })

  it('ayni challenge IKI KEZ kullanilamaz', async () => {
    const { auth, issued } = setup()
    const c = auth.challenge(addr)
    if (!c.ok) return
    const sig = sign(c.message, user)

    expect((await auth.verify(addr, c.message, sig)).ok).toBe(true)
    // Replay: ayni imza tekrar gonderiliyor. Ikinci token URETILMEMELI.
    const again = await auth.verify(addr, c.message, sig)
    expect(again.ok).toBe(false)
    expect(issued).toHaveLength(1)
  })

  it('challenge alinmadan verify cagrilamaz', async () => {
    const { auth } = setup()
    const other = setup()
    const c = other.auth.challenge(addr)
    if (!c.ok) return
    // Imza gecerli ama BU sunucu boyle bir challenge uretmedi.
    const r = await auth.verify(addr, c.message, sign(c.message, user))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toContain('challenge bulunamadi')
  })

  it('gecersiz adres challenge bile alamaz', () => {
    const { auth } = setup()
    for (const bad of [
      '',
      'abc',                                // kisa
      'O0Il' + 'A'.repeat(40),              // base58 disi harfler
      bs58.encode(user.secretKey),          // GIZLI ANAHTAR — asla
    ]) {
      expect(auth.challenge(bad).ok, bad.slice(0, 8)).toBe(false)
    }
  })

  it('program hesabi (PDA) adresi challenge alamaz', () => {
    const { auth } = setup()
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from('x')], Keypair.generate().publicKey)
    expect(auth.challenge(pda.toBase58()).ok).toBe(false)
  })

  it('gizli anahtar hata mesajinda ECHO EDILMEZ', () => {
    const { auth } = setup()
    const secret = bs58.encode(user.secretKey)
    const r = auth.challenge(secret)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).not.toContain(secret)
    expect(r.reason).not.toContain(secret.slice(0, 16))
  })

  it('suresi dolmus challenge reddedilir', async () => {
    const { auth, clock } = setup()
    const c = auth.challenge(addr)
    if (!c.ok) return
    const sig = sign(c.message, user)

    clock.advance(6 * 60_000)   // 5 dakikalik omru asti
    const r = await auth.verify(addr, c.message, sig)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toContain('suresi dolmus')
  })

  it('suresi gecmis challenge\'lar bellekte birikmez', () => {
    const { auth } = setup()
    for (let i = 0; i < 50; i++) auth.challenge(Keypair.generate().publicKey.toBase58())
    expect(auth.pendingCount()).toBeLessThanOrEqual(50)
  })
})
