# Linger — Yol Haritası (Solana)

> Bu dosya planın tek kaynağıdır. Bir milestone'u "bitti" saymak için **çıkış kriterlerinin hepsi** sağlanmış olmalı. Kriter sağlanmadıysa milestone açık kalır; kriter değiştirilecekse önce bu dosya değiştirilir, sonra iş yapılır.

Boyut etiketleri: **S** = birkaç saat, **M** = 1–3 gün, **L** = 1 hafta+. Takvim tarihi yok; sıra ve kriter var.

---

## 0. Şu an neredeyiz

| Alan | Durum |
|---|---|
| Reklam yüzeyi (statusLine / spinnerVerbs) | ✅ ölçüldü, zincirden bağımsız |
| Protocol, sunucu, defter, CLI, daemon | ✅ birim testler geçiyor (protocol 93, payments 74, sunucu 230, CLI 191) |
| Cüzdan girişi (imza mesajı, ed25519) | ✅ gerçek imzayla yerelde uçtan uca çalıştı; **tarayıcıda gerçek cüzdanla denenmedi** |
| `SolanaRail` (ödeme) | ✅ devnet'te kanıtlandı — 6/6 test geçti (2026-09-23): ATA açma, çoklu ödeme, idempotent tekrar, dondurulmuş hedef, expired |
| Yatırma izleyici (`SolanaDepositSource`) | ⚠️ yazıldı; sahte kaynakla test edildi; **gerçek bir yatırmayla henüz denenmedi** |
| Anchor vault programı | ✅ derleniyor, 15 litesvm testi geçiyor; **sunucuya bağlı değil**, deploy edilmedi |
| Deploy | ❌ yok |
| Frontend | ⚠️ eski sayfalar Solana cüzdanına uyarlandı; yeni tasarım Stitch'ten gelecek (`STITCH-BRIEF.md`) |

**Kanıtlanmamış hiçbir şey "çalışıyor" diye yazılmaz.** Bu tablo her milestone sonunda güncellenir.

---

## İlkeler (sadık kalınacaklar)

1. **Önce kanıt, sonra özellik.** Ödeme rayı gerçek ağda kanıtlanmadan vault entegrasyonuna, vault kanıtlanmadan mainnet'e geçilmez.
2. **"Ödendi" = hatasız + `finalized`.** Gönderilmiş ya da zincire girip patlamış işlem ödenmiş sayılmaz.
3. **Para tam sayıdır.** Micro-USDC (1e-6), `bigint`. Float yok. Defter tutarı = zincir tutarı.
4. **Yeniden kurma yok, yeniden gönderme var.** Retry aynı byte'ları yollar; yeni blockhash yalnızca blockhash ömrü dolduktan sonra.
5. **Sıcak cüzdan sınırlı.** İçinde ihtiyaçtan fazlası durmaz; USDC ve SOL ayrı izlenir.
6. **Anahtar görmeyiz.** Kullanıcı yalnızca mesaj imzalar. Gizli anahtar / seed yapıştırılırsa reddedilir ve asla loglanmaz.
7. **Dürüst kayıt.** Ölçülmeyen şey tabloda ⏳ kalır.

---

## M0 — Solana'ya taşıma ✅ (tamamlandı)

Kapsam: para birimi (6 hane), ödeme rayı, adres politikası, imza girişi, yatırma izleyici, Anchor vault, betikler, dokümanlar.

Çıkış kriterleri (hepsi sağlandı): tüm birim testler yeşil · paket derleniyor ve açılıyor · gerçek ed25519 imzasıyla giriş turu çalışıyor · eski zincire ve eski markaya ait iz kalmadı.

---

## M1 — Ödemeyi devnet'te kanıtla &nbsp;`M`

**Neden ilk:** Tüm ödeme mantığı mock'a karşı yazıldı. Gerçek ağdaki davranış farklı çıkarsa geri kalan her şey yanlış temel üzerine kurulur.

Yapılacaklar
- Devnet SOL'lu bir test cüzdanı hazırla (`faucet.solana.com`); gizli anahtarı `LINGER_DEVNET_PAYER` ile ver.
- `pnpm --filter @linger/payments test:devnet` koştur, 6 testin hepsini yeşile getir.
- Ölçümleri `spikes/README.md` tablosuna ve `PROJECT.md` §8'e işle.
- `SolanaDepositSource`'u gerçek bir yatırmayla dene (`scripts/devnet-faucet.mjs` + `test-campaign.mjs`).

Çıkış kriterleri
- [x] 6/6 devnet testi geçiyor (ATA açma, çoklu ödeme, dondurulmuş hedef, idempotent tekrar, expired) — 2026-09-23, test cüzdanı `BdtyYw62oAj3gyshKFaHumeBu9FyfzpUSsBj27B7VWi7`, `packages/payments/test/integration/devnet-payout.test.ts`.
- [ ] Ölçüldü ve yazıldı: 1232 baytta kaç hedef sığıyor (ATA'lı / ATA'sız), batch başı gerçek ücret, `confirmed` → `finalized` süresi. (Testler geçti ama sayılar henüz `spikes/README.md` ve `PROJECT.md` §8'e işlenmedi.)
- [ ] Yatırma izleyici gerçek bir yatırmayı doğru gönderene yazdı; aynı yatırma iki kez yazılmadı.
- [ ] `DEFAULT_BATCH_SIZE` (şu an 6) ölçüme göre onaylandı veya değiştirildi.

Bu milestone bitmeden M3 (deploy) başlamaz.

---

## M2 — Tarayıcı girişini gerçek cüzdanla doğrula &nbsp;`S`

Yapılacaklar
- `linger login` sayfasını Phantom, Solflare ve Backpack ile dene.
- Web panelindeki (`/app`, `/advertisers/app`) girişi aynı üç cüzdanla dene.
- Cüzdan reddi, yanlış ağ, cüzdan yok, süre dolması durumlarını dene.

Çıkış kriterleri
- [ ] Üç cüzdanda da `linger login` token'ı diske yazıyor, `linger whoami` doğru adresi gösteriyor.
- [ ] Reddedilen imza anlaşılır hata veriyor, takılı kalmıyor.
- [ ] Cüzdan yokken kurulum linkleri görünüyor.
- [ ] Bulunan uyumsuzluklar (ör. `signMessage` dönüş şekli) düzeltildi ve teste bağlandı.

Not: Mobil cüzdanlar (Wallet Standard / deep link) kapsam dışı; bkz. Açık Sorular.

---

## M3 — Devnet'e deploy ve ilk uçtan uca ödeme &nbsp;`M`

Yapılacaklar
- Railway'e deploy (Dockerfile hazır); kalıcı volume; `.env.example`'daki zorunlu değişkenler.
- Özel RPC sağlayıcı (herkese açık devnet RPC hız sınırlıdır).
- Sıcak cüzdan: devnet USDC + SOL, alarm eşikleri.
- `scripts/test-campaign.mjs --apply` ile: giriş → yatırma → kampanya → gösterim → eşik → ödeme.

Çıkış kriterleri
- [ ] Sağlık kontrolü yeşil, yeniden başlatmada bakiyeler korunuyor.
- [ ] Bir test yayıncısı zincirde gerçek ödeme aldı; tx imzası Explorer'da açılıyor.
- [ ] Landing sayfasındaki yer tutucu gerçek devnet işlem linkiyle değiştirildi.
- [ ] Ledger invariant denetimi (`ledger.audit()`) uçtan uca koşuda temiz.
- [ ] Sunucu ödeme sırasında öldürülünce (SIGKILL) asılı batch yeniden açılışta çözülüyor, çift ödeme yok.

---

## M4 — Vault programını devnet'e al ve sunucuya bağla &nbsp;`L`

Bugün sunucu reklamveren parasını sıcak cüzdanda tutuyor (hazine modeli). Vault, parayı programın kontrolüne alır: reklamveren kendi bakiyesini kendi imzasıyla çekebilir, yayıncı payı ve platform payı tek işlemde ayrılır.

Yapılacaklar
- Programı devnet'e deploy et; program ID'sini sabitle (`Anchor.toml` + sunucu config).
- `initialize` çağrısını deploy'la **aynı işlemde/hemen** yap ve `config` hesabını doğrula (ilk çağıran admin olur; başkası öne geçemesin).
- Sunucuya TypeScript istemcisi ekle (IDL `contracts/vault/idl/`): yatırma = `deposit`, ödeme = `release`, çekim = `withdraw`.
- Yatırma izleyiciyi program olaylarına (`Deposited`) bağla; hazine ATA taramasını kaldır.
- **Solvency denetimi:** vault token bakiyesi ≥ Σ reklamveren bakiyeleri; düzenli koşan iş + alarm.
- Admin anahtarını tek anahtardan çıkarma planı (bkz. M7).

Çıkış kriterleri
- [ ] Devnet'te deposit → release → withdraw sunucu üzerinden uçtan uca çalışıyor.
- [ ] Reklamveren kendi imzası olmadan çekemiyor; admin dışı `release` çağıramıyor (devnet'te denendi).
- [ ] Solvency işi vault bakiyesi ile defteri karşılaştırıyor; bilinçli bozulan durumda alarm veriyor.
- [ ] Sunucu çöküp yeniden açıldığında yarım kalan `release` çift ödeme üretmiyor.
- [ ] Sıcak cüzdanda reklamveren parası **kalmıyor** (yalnızca operasyonel SOL ve ödeme havuzu).

Karar gerekli: ödeme kaynağı vault'un `release` çıktısı mı, yoksa vault → sıcak cüzdan → yayıncı mı? Öneri: `release` doğrudan yayıncı ATA'sına; böylece ara bekleme yok. (Açık Sorular #3)

---

## M5 — Yeni frontend (Stitch) entegrasyonu &nbsp;`M–L`

Girdi: `STITCH-BRIEF.md` ile üretilen tasarım.

Yapılacaklar
- Tasarımı sayfalara dök; `packages/server/public/app.js` API katmanı olduğu gibi kullanılır (`login`, `api`, `usd`, `explorer`).
- Ekran durumları: bağlan · yükleniyor · ağ hatası · oturum düştü · boş · veri · yolda para · bekleme (adres değişikliği) · çekim.
- Reklamveren paneli: bakiye · yatırma adresi · kampanya oluştur/duraklat · çekim.
- Erişilebilirlik ve telefon genişliği.

Çıkış kriterleri
- [ ] Brief'teki her ekran durumu çalışan sayfada var.
- [ ] Para değerleri hiçbir yerde `parseFloat`'a girmiyor; ham micro değeri hover'da görülebiliyor.
- [ ] Gizli anahtar / seed yapıştırma uyarısı arayüzde de var.
- [ ] Üç cüzdanla giriş, çekim ve bekleme durumu elle denendi.

---

## M6 — Sertleştirme &nbsp;`L`

- **Operasyonel alarmlar:** sıcak cüzdan SOL < 0.05, USDC < bekleyen ödemeler, asılı (in-flight) batch yaşı, eşleşmeyen yatırma, RPC hata oranı.
- **RPC:** yedek sağlayıcı ve otomatik geçiş; `getSignatureStatuses` ile `getBlockHeight` aynı sağlayıcıdan.
- **Öncelik ücreti stratejisi:** sabit yerine ağ yoğunluğuna göre `getRecentPrioritizationFees`; tavan.
- **Fraud:** oran sınırları, cihaz başına kısıtlar, anormal desen kuralları (PROJECT.md §9).
- **Anahtar yönetimi:** sıcak cüzdan tavanı, soğuk cüzdandan doldurma prosedürü, anahtar rotasyonu.
- **Gizlilik ve ifşa:** PROJECT.md §10 ile kod eşleşmesi denetimi.
- **Bağımlılık taraması** ve kilit dosyası politikası.

Çıkış kriterleri
- [ ] Her alarm bilinçli tetiklenerek denendi.
- [ ] Sıcak cüzdan tavanı kodda zorlanıyor (aşılırsa ödeme durur).
- [ ] RPC sağlayıcısı kapatılınca ödeme bozulmadan yedeğe geçiyor.
- [ ] Fraud kuralları için saldırı senaryosu testleri yazıldı.

---

## M7 — Mainnet öncesi kapı &nbsp;`L`

Bu milestone bir **kapıdır**: buradaki her madde geçilmeden mainnet'e para konmaz.

- Vault programı için bağımsız güvenlik incelemesi (en az iç inceleme + harici gözden geçirme).
- Program **upgrade authority** ve **admin** tek anahtardan çıkarılır (multisig, ör. Squads).
- Mainnet program ID'si yeni anahtarla üretilir (devnet anahtarı kullanılmaz).
- Circle mainnet USDC mint'i (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) config'te doğrulanır; yanlış mint reddedilir.
- Yasal / vergi / ToS gözden geçirmesi (kullanıcıya ödeme yapan bir hizmet).
- Küçük tavanlı kapalı pilot: davetli yayıncılar, düşük günlük ödeme limiti.
- Felaket senaryosu tatbikatı: sıcak cüzdan anahtarı sızdı → prosedür uygulandı.

Çıkış kriterleri
- [ ] İnceleme bulguları kapatıldı veya kabul edilen risk olarak yazıldı.
- [ ] Admin/upgrade authority multisig'de; devnet'te devir denendi.
- [ ] Tatbikat yapıldı, süreler kaydedildi.
- [ ] Pilot limitleri kodda zorlanıyor.

---

## M8 — Mainnet kapalı beta → açık beta &nbsp;`L`

- Kapalı pilot (M7 sonu) → kademeli davet → açık kayıt.
- Gerçek USDC ile ilk ödemeler; günlük mutabakat raporu (defter ↔ zincir).
- Reklamveren tarafı açılışı: minimum yatırma, iade politikası.
- Destek süreci: "param nerede?" akışı (ödeme durumu, adres bekleme süresi, dondurulmuş hesap).

Çıkış kriterleri
- [ ] 30 gün boyunca defter ↔ zincir mutabakatında fark yok.
- [ ] Ödeme başarı oranı ve ortalama süre ölçüldü ve yayımlandı.
- [ ] Açık kayıt kararı yazılı olarak verildi.

---

## Açık sorular (karar bekliyor)

1. **ATA kirası kim öder?** Yeni yayıncıya ilk ödemede ~0.002 SOL (≈ birkaç on sent) hesap kirası gerekir ve şu an platform öder; $1 eşikle kıyaslandığında büyük olabilir. Seçenekler: (a) eşiği yükselt, (b) kirayı ilk ödemeden düş, (c) yayıncı ATA'sını kendisi açsın (cüzdanlar genelde açar), (d) platform öder ve kabul edilir. **Öneri:** (c) önce, olmazsa (b); M1'deki gerçek ölçümle karar ver.
2. **`finalized` mi `confirmed` mı?** Şu an `finalized` (~13 sn, geri dönmez). Kullanıcı deneyimi için `confirmed` yeterli mi? **Öneri:** ödemede `finalized`, kullanıcıya arayüzde `confirmed`'da "yolda" göster.
3. **Ödeme kaynağı (M4):** `release` → doğrudan yayıncı mı, vault → sıcak cüzdan → yayıncı mı? **Öneri:** doğrudan.
4. **Multisig / program hesabı (PDA) kullanıcılar:** şu an reddediliyor. Kurumsal reklamverenler için gerekli olabilir; mesaj imzası yerine on-chain kanıt gerekir. **Öneri:** M8 sonrası.
5. **Mobil cüzdanlar:** Wallet Standard / Mobile Wallet Adapter. CLI girişi masaüstü tarayıcı varsayıyor. **Öneri:** ihtiyaç kanıtlanana kadar ertele.
6. **Reklamveren yatırma yolu:** yalnızca cüzdan → vault mu, Solana Pay linki/QR de olsun mu? **Öneri:** önce yalnızca cüzdan.
7. **Ücret sponsorluğu:** yayıncı SOL'suz alabiliyor (biz ödüyoruz); reklamverenin yatırma ücreti kendi cüzdanından. Sorun çıkarsa fee-payer sponsorluğu.

---

## Kapsam dışı (şimdilik)

Tıklama atfı · Claude Code dışındaki adapter'lar · başka zincirler / başka stablecoin'ler · token / airdrop · mobil uygulama · reklamverenler için gelişmiş hedefleme.

---

## Bu dosyaya sadık kalma kuralları

- Yeni bir iş bu dosyada bir milestone'a bağlanır. Bağlanamıyorsa önce buraya yazılır (bir milestone eklenir ya da "kapsam dışı"ya girer).
- Milestone bitince: çıkış kutuları işaretlenir, §0 tablosu ve `README.md` "Verification status" tablosu güncellenir.
- Bir kriter karşılanamıyorsa kutu boş kalır ve nedeni yanına yazılır; kriter sessizce silinmez.
- Sıra: M1 → M2 → M3 → M4 → M6 → M7 → M8. M5 (frontend) M2'den sonra M3–M4 ile **paralel** yürüyebilir.
