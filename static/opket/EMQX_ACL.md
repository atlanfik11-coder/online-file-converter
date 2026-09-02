# EMQX ACL Rehberi

Bu rehber, uygulamanin broker tarafinda gereksiz yetki acigiyla calismamasi icin eklendi.

## Hedef

Tek MQTT kullanicisi kalsin ama topic yetkileri sadece uygulamanin kullandigi alanlarla sinirli olsun.

## Gerekli topic alanlari

Uygulama publish / subscribe olarak su alanlari kullaniyor:

- `opket/v4/+/chat`
- `opket/v4/+/profile/+`
- `opket/v4/+/pres/+`
- `opket/v4/+/lists/+`
- `opket/v4/+/musicroom/+`
- `opket/v4/+/movieroom/+`
- `opket/v4/+/call_room/+`
- `opket/v4/+/movie_sig/+`
- `opket/v4/+/call_sig/+`
- `opket/v4/+/event/+/#`
- `opket/v4/+/events/+`
- `opket/v4/+/server_meta`
- `opket/v4/_registry/members/+/#`

## En guvenli mantik

1. `Default deny`
2. Sadece yukaridaki topic desenlerine izin
3. Broker kullanicisini baska genel topiclere acmama

## Ornek izin yaklasimi

### Subscribe

- `opket/v4/+/#`
- `opket/v4/_registry/members/+/#`

### Publish

- `opket/v4/+/chat`
- `opket/v4/+/profile/+`
- `opket/v4/+/pres/+`
- `opket/v4/+/lists/+`
- `opket/v4/+/musicroom/+`
- `opket/v4/+/movieroom/+`
- `opket/v4/+/call_room/+`
- `opket/v4/+/movie_sig/+`
- `opket/v4/+/call_sig/+`
- `opket/v4/+/event/+/#`
- `opket/v4/+/events/+`
- `opket/v4/+/server_meta`
- `opket/v4/_registry/members/+/#`

## Not

Bu hala tek global MQTT kullanicisi modeli. Daha iyi seviye icin:

1. per-session broker token
2. kisa omurlu auth
3. sunucu bazli topic yetkisi

Ama bugunku halinle bile bu ACL, su ankinden belirgin daha guvenli olur.
