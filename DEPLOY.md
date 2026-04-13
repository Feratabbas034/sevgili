# Luna Protocol Deployment

Bu proje artik statik site degil. Public calismasi icin Node/Express sunucusu da ayakta olmali.

## Render ile yayinlama

1. Bu klasoru bir GitHub reposuna push et.
2. Render'da `New +` -> `Blueprint` sec.
3. Reponu bagla. Render `render.yaml` dosyasini okuyacak.
4. Deploy tamamlaninca ana sayfa public olur.
5. `ADMIN_KEY` Render environment ekraninda gorunur. Dashboard'a `https://senin-domain.com/admin` adresinden bu anahtarla gir.

## Neden Render

- Node uygulamasi dogrudan calisir.
- JSON log dosyasi icin persistent disk baglanabilir.
- Tek deploy ile frontend + backend birlikte yayinlanir.

## Lokal calistirma

- `npm install`
- `npm run build`
- `ADMIN_KEY=guclu-bir-key npm run start`

## Not

JSON dosya tabanli log sistemi kucuk/orta trafik icin uygundur. Buyuk trafik veya ciddi guvenlik ihtiyacinda veritabani daha dogru cozumdur.
