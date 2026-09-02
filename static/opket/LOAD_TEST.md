# Opket Load Test

Bu dosya registry ve realtime auth akisini hizli sekilde test etmek icin eklendi.

## Hizli kullanim

```powershell
node .\scripts\load-test-registry.mjs
```

Varsayilanlar:
- `baseUrl`: `https://opket.vercel.app`
- `serverCount`: `10`
- `membersPerServer`: `4`
- `includeRealtimeAuth`: `1`

## Parametreli kullanim

```powershell
node .\scripts\load-test-registry.mjs https://opket.vercel.app 25 4 1
```

Anlami:
1. base url
2. ayni anda olusturulacak sunucu sayisi
3. her sunucudaki uye sayisi
4. realtime auth kontrolu (`1` veya `0`)

## Ortam degiskenleri ile kullanim

```powershell
$env:OPKET_BASE_URL='https://opket.vercel.app'
$env:OPKET_LOAD_SERVERS='50'
$env:OPKET_LOAD_MEMBERS='5'
$env:OPKET_LOAD_REALTIME='1'
node .\scripts\load-test-registry.mjs
```

## Ne test ediyor

- `create`
- coklu `join`
- public `summary`
- her uye icin `touch`
- her uye icin `realtime-auth`
- `transfer_owner`
- yeni owner ile `delete`

## Onerilen siralama

1. `10 x 4`
2. `25 x 4`
3. `50 x 5`
4. sonucu izleyip sonra `100 x 5`

## Basarili cikti

JSON icinde:
- `okCount`
- `failedCount`
- `durationMs`

`failedCount = 0` ise test akisi gecmis demektir.
