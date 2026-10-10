# Linger vault (Solana / Anchor)

Reklamveren emanet kasasi. Reklamverenin USDC'si tek opak bir sicak cuzdanda
degil, bu programda reklamveren bazinda ayristirilmis olarak durur.

- `deposit` — reklamveren kendi imzasiyla yatirir.
- `withdraw` — reklamveren harcanmamis bakiyesini platformdan izin istemeden
  geri alir (sunucu kapali olsa bile).
- `release` — yalnizca admin; bir tutari yayinci ve platform arasinda
  `publisher_bps` ile boler, ikisine de AYNI transaction'da gonderir.
  Yuvarlama artigi platformda kalir.
- `initialize` — bir kez. `publisher_bps` sonradan degistirilemez.

Invariant: kasanin token bakiyesi >= butun `Balance` kayitlarinin toplami.

## Adresler (PDA)

| Hesap | Seeds | Not |
|---|---|---|
| `config` | `["config"]` | admin, mint, platform_token, publisher_bps |
| `vault` | `["vault"]` | USDC token hesabi; sahibi `config` PDA |
| `balance` | `["balance", advertiser_pubkey]` | `{ advertiser, amount: u64, bump }` |

Program ID: `3xRmSsG6i14rp1ddqfLP8v3qNqkWxEhG3C3qxPaNYdwA`
(keypair `target/deploy/linger_vault-keypair.json`, git'e girmez — mainnet
oncesi yeni bir keypair uretilir ve `declare_id!` + `Anchor.toml` guncellenir).

## Talimatlar

| Talimat | Arguman | Imzalayan | Hesaplar |
|---|---|---|---|
| `initialize` | `publisher_bps: u16` | `payer` | payer, admin, mint, platform_token, config, vault, token_program, system_program |
| `deposit` | `amount: u64` | `advertiser` | advertiser, config, mint, advertiser_token, vault, balance, token_program, system_program |
| `withdraw` | `amount: u64` | `advertiser` | advertiser, config, mint, advertiser_token, vault, balance, token_program |
| `release` | `amount: u64` | `admin` | admin, config, mint, advertiser, balance, vault, publisher_token, platform_token, token_program |

Tutarlar `u64`, USDC 6 ondalik (1 USDC = 1_000_000). Sifir tutar reddedilir.

Olaylar: `Deposited`, `Released`, `Withdrawn`. Hatalar (6000+):
`AmountNotPositive`, `InsufficientBalance`, `InvalidBps`, `Unauthorized`,
`InvalidDestination`, `Overflow`.

## Derleme ve test

```bash
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
anchor build     # target/deploy/linger_vault.so + target/idl/linger_vault.json
cargo test       # litesvm ile gercek .so uzerinde 15 test
```

`idl/linger_vault.json` TypeScript istemcisi icin sabit kopyadir; program
degisince `anchor build` sonrasi yeniden kopyalanir.

## Deploy notu

`initialize` ilk cagiran kisinin admin'i belirledigi tek seferlik bir islemdir.
Deploy'dan hemen sonra, baska biri araya girmeden cagrilmali ve `config`
hesabi dogrulanmalidir.

`release`'i imzalayan admin sunucuda duran SICAK bir anahtardir; bu program
imza-custody riskini sifirlamaz, yalnizca kimin ne kadar hakki oldugunu
zincirde dogrulanabilir yapar.
