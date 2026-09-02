# Google Play Yukleme Rehberi

Bu proje icin Google Play'e uygun Android sarmalayicisi `android/` klasorunde hazir.

## Hazir Dosyalar

- `android/app-release-bundle.aab`: Play Console'a yuklenecek dosya
- `android/app-release-signed.apk`: Istersen cihazda dogrudan test icin
- `android/release-summary.json`: paket kimligi ve imza ozeti
- `app-ads.txt`: AdMob dogrulamasi icin kok dizinde yayinlanacak dosya
- `.well-known/assetlinks.json`: alan adi dogrulamasi
- `PLAY_STORE_LISTING_TR.md`: magaza metin taslagi

## Uygulama Bilgileri

- Paket kimligi: `com.atlamfik.opket`
- Uygulama adi: `Opket`
- Gizlilik politikasi: `https://opket.vercel.app/privacy.html`
- Gelistirici web sitesi: `https://opket.vercel.app`
- App-ads dosyasi: `https://opket.vercel.app/app-ads.txt`
- Destek e-postasi: `atlamfik@gmail.com`
- Yukleme dosyasi: `android/app-release-bundle.aab`

## Android Tarafinda Yapilan Hazirliklar

- Android telefon icin ekran paylasimi kaldirildi
- `FOREGROUND_SERVICE_MEDIA_PROJECTION` ile ilgili izin ve servis kaldirildi
- Kamera ve mikrofon ozellikleri istege bagli olacak sekilde birakildi
- `allowBackup` kapatildi
- Uygulama kategorisi `social` olarak ayarlandi

## Play Console'a Yukleme Sirasi

1. [Google Play Console](https://play.google.com/console) adresine gir.
2. `Create app` ile yeni uygulama olustur.
3. Uygulama adi olarak `Opket` yaz.
4. Default language sec.
5. App type olarak `App`, ucretlendirme icin `Free` sec.
6. Sol menuden `Dashboard` ve sonra gerekli kurulum kartlarini doldur.
7. `App content` bolumunde su cevaplari kullan:
   - Privacy policy: `https://opket.vercel.app/privacy.html`
   - Ads: AdMob kullanacagin bu surum icin `Yes`
   - App access: genel kullanim ise `No restrictions`
   - Target audience: cocuk uygulamasi degilse bunu uygun sekilde isaretle
   - Content rating: sosyal ve kullanici icerigi oldugu icin anketi gercek kullanimina gore doldur
8. `Store settings` veya `App details` bolumunde gelistirici web sitesi olarak `https://opket.vercel.app` gir.
9. `https://opket.vercel.app/app-ads.txt` adresinin acildigini kontrol et.
10. `Data safety` bolumunde en az su mantikla beyan ver:
   - Kullanici tarafindan olusturulan icerik isleniyor
   - Profil adi, mesajlar ve paylasilan medya uygulama calismasi icin kullaniliyor
   - Kamera ve mikrofon yalnizca kullanici ozelligi acarsa kullaniliyor
   - Veri aktarimi sifreli
11. `Store listing` bolumunde [PLAY_STORE_LISTING_TR.md](/C:/Users/atifa/Desktop/Opket%20-%20Kopya/PLAY_STORE_LISTING_TR.md) icindeki metinleri kullan.
12. En az 2 telefon ekran goruntusu yukle.
13. `Release` bolumunde once `Testing > Internal testing` ac.
14. Yeni release olustur ve `android/app-release-bundle.aab` dosyasini yukle.
15. Google'in otomatik kontrolleri tamamlaninca release notu ekle.
16. Internal test linki ile uygulamayi telefonda kurup test et.
17. Test temizse sirayla `Closed testing` ve sonra `Production` yayinina gec.

## Yuklemeden Once Son Kontrol

- Gizlilik politikasi linki tarayicida aciliyor olmali
- `https://opket.vercel.app/app-ads.txt` aciliyor olmali
- Kamera izni calisiyor olmali
- Mikrofon izni calisiyor olmali
- Uygulama acilisinda cokus olmamali
- `android/app-release-bundle.aab` guncel olmali

## Bundle Yeniden Uretme

Gerekirse yeni bundle almak icin:

```powershell
node .\scripts\prepare_play_android.mjs --build
```

Alternatif olarak Android klasorunden:

```powershell
.\gradlew.bat bundleRelease
```

## Onemli Not

Google Play'e yuklerken APK degil, AAB yukle. Bu proje icin dogru dosya `android/app-release-bundle.aab`.
