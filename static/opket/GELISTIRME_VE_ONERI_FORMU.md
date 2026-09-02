# 🚀 OPKET Uygulaması Kapsamlı Geliştirme, İnovasyon ve Yol Haritası Formu

Bu form, **Opket** uygulamasının mevcut mimarisini, güçlü ve eksik yönlerini analiz ederek gelecekte eklenebilecek teknik ve ürün bazlı özellikleri aşamalar halinde sunar. İhtiyaç duyduğunuz maddeleri önceliklendirebilir veya doğrudan uygulamaya geçebilirsiniz.

---

## 📋 1. Mevcut Mimari ve Durum Özeti

| Katman | Kullanılan Teknoloji / Yapı | Durum |
| :--- | :--- | :--- |
| **Ön Yüz (Frontend)** | Vanilla JavaScript, HTML5, CSS3 Glassmorphism | Tek sayfa (SPA), hafif ve hızlı |
| **Gerçek Zamanlı İletişim** | MQTT over WebSocket (`broker.emqx.io` / Özel Broker) | Düşük gecikmeli mesajlaşma |
| **Ses & Ekran Paylaşımı** | WebRTC Full-Mesh (`RTCPeerConnection`) | 2-4 kişi için ideal, 10 kişi için SFU önerilir |
| **Kullanıcı & Sunucu Kapasitesi** | Maksimum **10 kişi / sunucu** | Kural ve doğrulama seviyesinde sabitlendi |
| **Yönetici Paneli (Admin)** | `/api/admin-session`, `/api/admin-servers` | Modern modal, çoklu şifre ve yerel önizleme desteği aktif |

---

## 🛠️ 2. Geliştirme ve Özellik Öneri Formu

Aşağıdaki maddeler, uygulamanızı Discord / Clubhouse / Rave / Gather karışımı modern, kararlı ve popüler bir platforma dönüştürmek için tasarlanmıştır.

### 🎙️ A. Ses, Görüntü ve Medya Odaları (Sesli Deneyim)

- [ ] **1. WebRTC SFU / Mediasoup / LiveKit Entegrasyonu (Kritik):**
  - *Mevcut Durum:* Full-mesh WebRTC kullanılıyor. 10 kişi aynı anda sesli odaya girdiğinde her cihaz 9 ayrı bağlantı açmak zorunda kalır (N*(N-1)/2 bağlantı), bu da mobil cihazlarda aşırı ısınmaya ve donmaya yol açar.
  - *Çözüm:* SFU (Selective Forwarding Unit) sunucusu entegre edilerek 10 kişinin kristal netliğinde ve sıfır donma ile konuşması sağlanabilir.
- [ ] **2. Sesli Odada Konuşan Kişi Göstergesi (Speaking Indicator):**
  - Web Audio API `AudioContext` kullanılarak mikrofon ses seviyesi analiz edilir, o an konuşan kullanıcının avatarının etrafında yeşil/mor parlama (glow efekti) gösterilir.
- [ ] **3. Gürültü Engelleme ve Eko Önleme (Noise Suppression):**
  - `navigator.mediaDevices.getUserMedia` parametrelerine yapay zeka destekli gürültü filtresi (örneğin WebRTC RNNoise WASM modülü) eklenerek arkadaki fan, klavye ve sokak sesleri filtrelenebilir.
- [ ] **4. Eşzamanlı Sesli + Görüntülü Watch Party (Film/Dizi İzleme):**
  - MP4 video paylaşımına ek olarak HLS/m3u8 canlı akış ve YouTube senkron izleme odası.
  - Oynat/Durdur senkronizasyonunun MQTT ile milisaniye hassasiyetinde (`ping` telafili) yapılması.

---

### 💬 B. Sohbet & Etkileşim Katmanı

- [ ] **1. Görsel & Medya Paylaşımı (Cloud Storage):**
  - Mesajlaşmada şu an sadece metin var. Cloudinary, AWS S3 veya Cloudflare R2 entegrasyonu ile sohbet içine fotoğraf, kısa video ve ses kaydı (Voice Notes) gönderme.
- [ ] **2. Mesaj Reaksiyonları (Emoji Reactions):**
  - Mesaja basılı tutulduğunda (long-press) veya üzerine gelindiğinde hızlı emoji tepkileri (`❤️`, `🔥`, `😂`, `👍`, `👏`).
- [ ] **3. Mesaj Sabitleme (Pin Messages):**
  - Sunucu kurucusunun önemli kuralları veya linkleri sohbetin en üstüne sabitleyebilmesi.
- [ ] **4. Bahsetme / Etiketleme (Mentions):**
  - `@kullanıcı` yazıldığında o kişiye bildirim gitmesi ve isminin renkli vurgulanması.
- [ ] **5. GIF Arama Motoru (Tenor / Giphy API):**
  - Sohbet kutusuna tıklandığında hızlıca trend GIF'leri arayıp odaya atabilme.

---

### 🛡️ C. Sunucu Yönetimi, Roller & Moderasyon

- [ ] **1. Rol & Yetkilendirme Sistemi:**
  - `Kurucu (Owner)`, `Moderatör (Admin)`, `VIP Üye`, `Normal Üye` rolleri.
  - Moderatörlere mikrofon susturma (server-mute) ve sohbeti temizleme yetkisi.
- [ ] **2. Gelişmiş Kick / Ban / Timeout Mekanizması:**
  - Rahatsızlık veren kullanıcıyı sunucudan geçici (5 dk, 1 saat) veya kalıcı olarak uzaklaştırma.
- [ ] **3. Küfür / İstenmeyen Kelime Filtresi (Oto-Mod):**
  - Regex ve kelime listesi tabanlı yerel içerik denetleyicisi ile spam ve küfürlerin otomatik engellenmesi.
- [ ] **4. Sunucu Giriş Parolası veya Davet Linki:**
  - Sunucu kodunun yanında istenirse 4 haneli özel bir oda şifresi tanımlayabilme.

---

### 📱 D. Mobil Deneyim, PWA ve Bildirimler

- [ ] **1. Web Push Bildirimleri (Service Worker Push API):**
  - Kullanıcı tarayıcıyı veya uygulamayı kapattığında bile birisi ona mesaj attığında veya sesli odaya girdiğinde kilit ekranına bildirim gitmesi.
- [ ] **2. Arka Planda Ses Çalma (Background Audio WakeLock):**
  - Müzik dinlerken veya sesli odadayken telefon kilitlendiğinde sesin kesilmemesi için Media Session API ve Ses Servisi optimizasyonu.
- [ ] **3. Android APK & Google Play Yayını:**
  - Projedeki `android/` klasörünün TWA (Trusted Web Activity) veya Capacitor ile tam native performansta derlenip Google Play Store'a yüklenmesi.
- [ ] **4. iOS Safari PWA / Add to Home Screen İyileştirmeleri:**
  - iOS tam ekran deneyimi için safe-area-inset ve home bar uyumlarının kusursuzlaştırılması.

---

### 📊 E. Yönetici (Admin) Paneli Geliştirmeleri

- [ ] **1. Canlı Sunucu Trafiği ve MQTT Broker Sağlık Monitörü:**
  - Anlık CPU, bellek, WebSocket bağlantı sayısı ve gecikme (ping) grafiklerinin admin panelinde canlı akması.
- [ ] **2. Sistem Genelinde Duyuru Gönderme (Broadcast Banner):**
  - Admin panelinden tek tuşla tüm aktif sunuculardaki kullanıcılara "Sunucu bakımı 10 dakika sonra başlayacaktır" gibi anlık modal/banner basabilme.
- [ ] **3. Yasaklı IP / Cihaz Listesi:**
  - Kötüye kullanım yapan kullanıcıların veya botların platforma erişimini admin panelinden tek tıkla engelleme.

---

### 💰 F. Monetizasyon ve Gelir Modelleri

- [ ] **1. Sunucu Yükseltmeleri (Server Boost):**
  - Standart 10 kişi limitini aşmak isteyen topluluklar için (Örn: 25 veya 50 kişilik sunucu) abonelik / tek seferlik satın alma paketi.
- [ ] **2. Özel Özelleştirmeler:**
  - Özel profil rozetleri, animasyonlu avatarlar, neon sunucu temaları.
- [ ] **3. Entegre Ödeme Altyapısı (Iyzico / Stripe / Google Play Billing):**
  - Güvenli checkout akışı ile doğrudan uygulama içi satın alma.

---

## 🎯 3. Öncelikli İlk Adım Tavsiyesi (Quick Wins)

Uygulamanın şu anki kararlılığını zirveye çıkarmak için önerilen sıralama:

1. **Sesli Konuşma Göstergesi:** Konuşanın etrafında dalgalanan animasyon (Kullanıcı deneyimini anında 2 katına çıkarır).
2. **Fotoğraf Gönderme:** Sohbet paneline bir kamera/fotoğraf butonu eklenmesi.
3. **Web Push Bildirimleri:** Kullanıcıların uygulamayı terk ettikten sonra geri gelmesini sağlar (Retention).
4. **Arka Plan Müzik Devamlılığı:** Ekran kilitlendiğinde müziğin kesintisiz devam etmesi.
