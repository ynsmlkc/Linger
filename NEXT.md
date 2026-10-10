# Sırada ne var

> Son güncelleme: 2026-09-21. Otorite `PROJECT.md`; yol haritası `ROADMAP.md`. Burası yalnızca dürüst bir durum özeti ve sıradaki işlerin listesi.

## Nerede duruyoruz

Omurga Solana'ya taşındı ve birim testlerin hepsi geçiyor. **Gerçek bir Solana ağında henüz hiçbir şey kanıtlanmadı.**

```
✅ protocol     93 test   para (micro = 1e-6 USDC), sanitizer, şemalar, saat enjeksiyonu
✅ payments     74 test   adres kontrolü, cüzdan imzası (SIWS), batch ödeme mantığı, arıza modları (mock rail)
✅ sunucu      230 test   reklam seçimi, gösterim kabulü, doğrulama, defter, HTTP, çekim, yatırma
✅ CLI         191 test   daemon, hook, login, balance, settings
✅ vault        15 test   Anchor programı, litesvm ile gerçek .so üzerinde
```

## Doğrulanmadı (bunları "çalışıyor" diye anma)

- **Devnet entegrasyon testi koşturulmadı.** `packages/payments/test/integration/devnet-payout.test.ts` (6 test) yazıldı; devnet SOL musluğu hız sınırı (429) verdi. Test kendi geçici SPL mint'ini üretir, Circle musluğu gerekmez; yalnızca fonlanmış bir cüzdan lazım (`LINGER_DEVNET_PAYER`).
- **`SolanaRail` gerçek ağda hiç çalışmadı.** Ücret, ATA açma maliyeti, `finalized` gecikmesi, dondurulmuş hesapla batch'in düşmesi, aynı byte'ların ikinci gönderiminin çift ödeme yapmaması — hepsi tasarım ve mock testlerle kapalı, ölçülmedi.
- **Yatırma izleyicisi (`SolanaDepositSource`) gerçek ağda hiç çalışmadı.** Göndereni token bakiye farklarından bulma mantığı yalnızca sahte kaynakla test edildi.
- **Vault programı devnet'e deploy edilmedi ve sunucuya bağlı değil.** Sunucu hâlâ sıcak cüzdan hazinesi akışını kullanıyor (ADR-025).
- **Phantom/Solflare/Backpack ile gerçek giriş bir tarayıcıda denenmedi.** `signMessage` yanıt biçimleri (Phantom/Solflare `{signature}`, Backpack ham bayt) koddan yazıldı, cüzdanla doğrulanmadı.
- **CLI giriş sayfası (`linger login`) bir tarayıcıda açılıp denenmedi.**
- Devnet USDC mint'i (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`) ve mainnet mint'i (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) koda girdi ama ağdan teyit edilmedi.

## Sıradaki adımlar

1. **Devnet'i koştur.** Geçici test cüzdanını `faucet.solana.com`'dan fonla, `LINGER_DEVNET=1 LINGER_DEVNET_PAYER=<anahtar> pnpm --filter @linger/payments test:devnet`. Sonuçları `PROJECT.md` §12.2'deki Kıvılcım 2 tablosuna işle.
2. **Mint'leri ağdan teyit et** (ondalık = 6, dondurma yetkisi kimde) ve §15.8'e yaz.
3. **Yatırma akışını devnet'te dene.** `scripts/devnet-faucet.mjs` ile havuz kur, `scripts/test-campaign.mjs --apply` ile bir reklamveren yatırması yap, izleyicinin göndereni doğru bulduğunu gör.
4. **Girişi tarayıcıda dene.** Yerel sunucuyu aç, `/app` ve `linger login` sayfalarından gerçek bir cüzdanla imzala; üç cüzdanın `signMessage` yanıtını doğrula.
5. **Uçtan uca bir tur.** Gösterim → doğrulama → çekim → devnet'te gerçek transfer → Solana Explorer linki.
6. **Vault'u devnet'e deploy et**, `initialize`'ı hemen çağır, `config`'i doğrula. Sonra `VaultRail` + config flag'li kablolama (ADR-025).
7. **Program kimliğini yenile.** Üretilen program anahtarı mainnet öncesi değiştirilmeli (`declare_id!` + `Anchor.toml`).
8. **Sıcak cüzdan izleme.** SOL alt sınırı (0,05 SOL) ve USDC tavanı için alarm; mainnet öncesi `solvency_check` (§15.10).

## Dwell'den taşınanlar (2026-10-10)

Dwell'in 2026-09-29 ile 2026-10-04 arasındaki commit'leri Solana'ya uyarlanarak buraya alındı. Birim testleri geçiyor. **Gerçek veriyle ya da tarayıcıda hiçbiri denenmedi.**

- **Sıralama ve dünya küresi:** `profiles` tablosu (takma ad, ülke, `listed` varsayılan kapalı), `PUT/GET /v1/me/profile`, `GET /v1/leaderboard`, `/v1/leaderboard/countries`, `/v1/leaderboard/profile/:nick`. Kazanç defterden hesaplanıyor, kendi reklamından gelen gösterim sayılmıyor. Ana sayfaya küre (`public/globe.js`) ve tablo eklendi, panele "Show me on the leaderboard" formu, gizlilik sayfasına "The leaderboard" bölümü.
- **Ülke tahmini:** önce platform başlığı (`cf-ipcountry`, `x-vercel-ip-country`), yoksa DB-IP Lite veritabanı (Docker derlemesinde indiriliyor, CC BY 4.0). IP saklanmıyor. Doğrulama değil, yalnızca öneri.
- **CLI:** `linger login` sonunda isteğe bağlı sıralama adımı, yeni `linger profile` komutu. Sürüm 0.1.14.
- **Sponsor havuzları:** `pools` + `pool_members`, kampanyalara `pool_id` / `submitted_by`. Havuz üyesi yalnızca kendi havuzunun projelerini görür, kendi projesini görmez. Üye başına günlük sınır (varsayılan 200, en fazla 2.000), havuz bütçesi, açık havuzlara ayrılan para reklamveren çekiminden düşülüyor (`src/pools/reserve.ts`). Pilot için doğal alan: Solana hackathon'ları.
- **Fraud sertleştirmesi:** `/v1/ads/next` hız sınırı (`src/http/rate-limit.ts`), `env.ts`: üretimde `LINGER_IP_SALT` zorunlu, `LINGER_PENDING_MS` 1 saatin altındaysa sunucu açılmaz, `LINGER_MIN_CLIENT_VERSION`. Üretimde 100.000 USDC'lik dev tohumu yazılmıyor.
- **Tek sıcak cüzdan kuyruğu:** bütün çekimler ve mutabakat tek `SolanaRail` + `createSerial()` kuyruğundan geçiyor. Asılı çekimler `LINGER_RECONCILE_MS` aralığıyla periyodik çözülüyor.
- **CLI düzeltmeleri:** `settings.json` atomik yazılıyor (symlink korunuyor), Stop hook'u gelmeden sessizleşen tur kapanıyor.
- **CI:** her push'ta typecheck + test (`.github/workflows/ci.yml`).

### Açık kararlar (Dwell'deki gibi)

- Sıralamayı yayına almadan önce sahte gösterim savunması yeterli mi?
- Boş liste: "Nobody is listed yet" mi, yoksa ilk N kişiye kadar gizli mi?
- Havuzlarda platform payı düşsün mü, havuzun bitiş tarihi zorunlu mu?

## Reklam seçimi: fiyat sıralı kuyruk + ikinci fiyat (karar, 2026-10-10)

ADR-009'un ikinci revizyonu. SWRR (teklife orantılı pay) yerine geçiyor.

### Neden değişiyor

- **SWRR'de teşvik bozuk.** Teklifi 2 katına çıkaran hem gösterim başına 2 kat ödüyor hem 2 kat pay alıyor: harcama 4 kat (PROBLEMS.md #8c). "Daha çok ödeyip önce çıkmak" diye bir seçenek yok.
- **Yayıncı eksik kazanıyor.** Pahalı reklamın bütçesi dururken ucuz reklam da gösteriliyor; her fırsat olabileceğinden ucuza satılıyor.
- **Tahmin edilemiyor.** "Bloklarım ne zaman biter" sorusunun cevabı diğerlerinin teklifine göre sürekli değişiyor.
- **Kickbacks'in saf kuyruğu da yeterli değil.** Hız ayarı olmadan tek pahalı reklamveren bütün ağı tutuyor (kullanıcı saatlerce aynı satırı görüyor) ve birinci fiyat, reklamvereni rakibin teklifini tahmin etmeye zorluyor.

### Kurallar

1. **Fiyat sıralı kuyruk.** Her gösterim fırsatında uygun kampanyalar blok başına teklife göre sıralanır, en yüksek kazanır. Eşitlikte bu yayıncıya en uzun süredir gösterilmeyen önce gelir (yeniden başlatmada hep aynı kampanyanın kazanmasını önleyen eski kural korunuyor).
2. **İkinci fiyat.** Kazanan kendi teklifini değil, aynı fırsat için yarışan bir sonraki teklifin bir kuruş (blok başına $0.01) fazlasını öder; asla kendi teklifinden fazla değil. Rakip yoksa taban fiyatı (`MIN_BID_CPM`, blok başına $0.10) öder. Aynı reklamverenin diğer kampanyaları "rakip" sayılmaz: kendi fiyatını kendisi yükseltemez. Fiyat teslim anında dondurulur (ADR-011), defter değişmez.
3. **Hız ayarı (pacing).** Slow / Medium / Fast günlük tavana dönüşür (toplam ÷ 7 gün / 3 gün / sınırsız). Panelde varsayılan **Medium**. Tavanına gelen kampanya o gün kuyruktan çıkar, fırsat sıradakine düşer: pahalı reklamveren ağı tek başına tutamaz.
4. **Kişi başı sıklık sınırı (yumuşak).** Aynı yayıncıya aynı kampanya son 1 saatte 3 kez gösterildiyse, o yayıncı için sınırda olmayan kampanyalar önce gelir. Herkes sınırdaysa en yüksek teklif yine gösterilir: sınır sırayı değiştirir, kimseyi susturmaz. Sert sınır olsaydı az kampanyalı bir ağda yayıncı saatin çoğunda reklamsız kalırdı (eski `frequencyCap` %50/%50 kilidiyle aynı tuzak, PROBLEMS.md #8a).

### Örnek

A blok başına $3 teklif, B $2, C $0.50. Hepsi uygun, kimse sınırda değil:
- A kazanır, blok başına **$2.01** öder (B + 1 kuruş). Gösterim başına $0.00201; yarısı geliştiriciye.
- A o yayıncıya bu saat 3 kez gösterildiyse sıradaki fırsatı B kazanır ve **$0.51** öder (C + 1 kuruş).
- A'nın günlük tavanı dolduysa A o gün kuyrukta yok; B kazanır, $0.51 öder.

### Yapılacaklar

- [x] `selector.ts`: SWRR yerine fiyat sıralaması, ikinci fiyat, yumuşak sıklık sınırı, ayarlanabilir taban fiyat (`reserveCpm`)
- [x] Ödenen fiyat `AdSelection.rate`'e (teslimatta dondurulan) yazılsın; bütçe kontrolleri teklif üzerinden (üst sınır) kalsın
- [x] Ortalama ödenen blok fiyatı: panel `/v1/advertiser/stats`'taki harcama ÷ gösterimden hesaplıyor, ayrı alan gerekmedi
- [x] Panel: "ödediğin fiyat" sütunu, varsayılan hız Medium, ikinci fiyat açıklaması
- [x] ADR-009 testleri yeniden yazılsın (SWRR pay testleri kalkıyor)
- [x] PROJECT.md ADR-009'a revizyon notu
- [ ] Gerçek ağda doğrulama: iki reklamveren, fonlanmış bakiye, ödenen fiyatın defterde ikinci fiyat olduğunu gör

### Bilinen sınırlar

- Sıklık sayacı bellekte tutuluyor, yeniden başlatmada sıfırlanır (sınır yumuşak olduğu için zararı küçük).
- Günlük tavan gün başında harcamayı öne yığar; gün içinde eşit yayma (saatlik tavan) ileride.
- Az rekabette gelir düşer: tek reklamveren taban fiyatı öder. Taban fiyat ileride ağ büyüklüğüne göre yükseltilebilir.

## Bilinen sınırlar

- Multisig kasalar ve PDA adresleri desteklenmiyor (mesaj imzalayamazlar); Squads ayrı bir karar.
- Otomatik periyodik ödeme kapalı; yayıncı istediği an çekiyor (ADR-006 revizyonu).
- Frontend yeniden tasarlanacak; mevcut sayfalar yalnızca API'yi çağıran işlevsel kalıp.
