/**
 * Cuzdan giris imzasi (SIWS) — ADR-014.
 *
 * Gercek ed25519 imzalariyla: cuzdanin `signMessage` yaptigi seyin ayni.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Keypair } from '@solana/web3.js'
import nacl from 'tweetnacl'
import { fixedClock, fakeIdGenerator } from '@linger/protocol'
import { Siws } from '../src/siws.js'

const DOMAIN = 'linger.example'

let clock: ReturnType<typeof fixedClock>
let siws: Siws
let user: Keypair

/** Cuzdanin yaptigi: mesaji UTF-8 byte'larina cevirip imzala, base64 dondur. */
const sign = (kp: Keypair, message: string): string =>
  Buffer.from(nacl.sign.detached(Buffer.from(message, 'utf8'), kp.secretKey)).toString('base64')

beforeEach(() => {
  clock = fixedClock(1_700_000_000_000)
  siws = new Siws({ domain: DOMAIN, network: 'devnet', ttlSec: 300 }, clock, fakeIdGenerator())
  user = Keypair.generate()
})

describe('challenge', () => {
  it('mesaj alan adini, adresi ve agi icerir', () => {
    const c = siws.challenge(user.publicKey.toBase58())
    expect(c.message).toContain(DOMAIN)
    expect(c.message).toContain(user.publicKey.toBase58())
    expect(c.message).toContain('Chain: devnet')
  })

  it('kullaniciya bunun bir islem olmadigini soyler', () => {
    expect(siws.challenge(user.publicKey.toBase58()).message).toMatch(/islem degildir/)
  })

  it('her challenge farkli nonce tasir', () => {
    const a = siws.challenge(user.publicKey.toBase58()).message
    const b = siws.challenge(user.publicKey.toBase58()).message
    expect(a).not.toBe(b)
  })

  it('suresi ttl kadar', () => {
    expect(siws.challenge(user.publicKey.toBase58()).expiresAt).toBe(clock.now() + 300_000)
  })
})

describe('verify', () => {
  it('dogru imza kabul edilir', () => {
    const addr = user.publicKey.toBase58()
    const { message } = siws.challenge(addr)
    const r = siws.verify(addr, message, message, sign(user, message))
    expect(r).toEqual({ ok: true, account: addr })
  })

  it('BASKA anahtarla atilan imza reddedilir', () => {
    const addr = user.publicKey.toBase58()
    const { message } = siws.challenge(addr)
    const r = siws.verify(addr, message, message, sign(Keypair.generate(), message))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('gecersiz_imza')
  })

  it('istemcinin kendi sectigi mesaj kabul edilmez — imza gecerli olsa bile', () => {
    // Saldirgan kendi metnini imzalatip gonderir. Sunucu yalnizca URETTIGI
    // mesajin imzasini kabul eder.
    const addr = user.publicKey.toBase58()
    const { message } = siws.challenge(addr)
    const evil = message.replace('Nonce:', 'Nonce: 0000')
    const r = siws.verify(addr, message, evil, sign(user, evil))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('mesaj_uyusmuyor')
  })

  it('suresi dolmus challenge reddedilir', () => {
    const addr = user.publicKey.toBase58()
    const { message } = siws.challenge(addr)
    clock.advance(301_000)
    const r = siws.verify(addr, message, message, sign(user, message))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('suresi_dolmus')
  })

  it('bozuk imza uzunlugu reddedilir', () => {
    const addr = user.publicKey.toBase58()
    const { message } = siws.challenge(addr)
    const r = siws.verify(addr, message, message, Buffer.from('kisa').toString('base64'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('gecersiz_imza')
  })

  it('bozuk adres reddedilir', () => {
    const { message } = siws.challenge('x')
    const r = siws.verify('bozuk', message, message, sign(user, message))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('gecersiz_adres')
  })

  it('imza baska adrese ait mesaj icin gecerli olsa da bu adrese baglanmaz', () => {
    const a = user.publicKey.toBase58()
    const other = Keypair.generate()
    const { message } = siws.challenge(other.publicKey.toBase58())
    // `user` adresi icin, `other` icin uretilmis mesaj sunuluyor.
    const r = siws.verify(a, siws.challenge(a).message, message, sign(other, message))
    expect(r.ok).toBe(false)
  })
})
