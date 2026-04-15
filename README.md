# Pixel Polska

Responsywna aplikacja Next.js 16 do zakupu prostokatnych obszarow pikseli.
Plansza ma 1 000 000 pikseli w ukladzie 1000x1000.

Szczegoly architektury: `ARCHITECTURE.md`.

## Co zostalo wdrozone

- UI mobile-first (iOS/Android/Windows/macOS), automatyczne skalowanie planszy.
- Rozdzielenie krokow: `Zaplac` i `Zapisz piksele`.
- Wymagany checkbox: `Akceptuje i place`.
- Ochrona przed podwojnym zakupem tych samych pikseli (blokada zapisu + walidacja konfliktu przy zapisie).
- Rate limiting na API (`GET`, `POST`, `DELETE`).
- Health endpoint: `GET /api/health`.
- Hardened security headers w `next.config.ts`.
- Przygotowanie pod konteneryzacje i Kubernetes z autoscalingiem.

## Uruchomienie lokalne

Wymagania:

- Node.js 20.9+
- npm

Kroki:

```bash
npm install
npm run dev
```

Aplikacja bedzie dostepna pod `http://localhost:3000`.

## Model danych i wspolbieznosc

Dane sa trzymane w `data/pixels.json`.

Kluczowe zabezpieczenie przed podwojnym zakupem:

1. Przy `POST /api/pixels` serwer waliduje obszar.
2. Serwer zaklada lock (`pixels.lock`) na czas transakcji zapisu.
3. W locku ponownie sprawdza konflikt i dopiero wtedy zapisuje.

Dzieki temu, gdy kilka osob probuje kupic te same piksele naraz, tylko pierwszy poprawny zapis przechodzi, kolejne dostaja `409`.

## API

- `GET /api/pixels` - lista zajetych obszarow.
- `POST /api/pixels` - zakup i zapis obszaru.
- `DELETE /api/pixels` - reset planszy.
- `GET /api/health` - healthcheck pod liveness/readiness.

## Docker

Build obrazu:

```bash
docker build -t pixel-polska:latest .
```

Run:

```bash
docker run --rm -p 3000:3000 pixel-polska:latest
```

## Produkcja online (VPS + HTTPS)

Gotowy runbook i pliki deploymentu:

- `DEPLOY_VPS.md`
- `deploy/docker-compose.prod.yml`
- `deploy/Caddyfile`
- `.env.production.example`

## Kubernetes + autoscaling

Manifesty sa w katalogu `k8s/`:

- `namespace.yaml`
- `configmap.yaml`
- `secret.example.yaml`
- `pvc.yaml`
- `deployment.yaml`
- `service.yaml`
- `ingress.yaml`
- `hpa.yaml`
- `pdb.yaml`
- `networkpolicy.yaml`

Przykladowy rollout:

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.example.yaml
kubectl apply -f k8s/pvc.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/pdb.yaml
kubectl apply -f k8s/networkpolicy.yaml
kubectl apply -f k8s/hpa.yaml
```

## Uwaga produkcyjna (bardzo wazna)

Dla ruchu 1000+ jednoczesnych uzytkownikow i wielu podow, docelowo zalecana jest baza SQL (np. PostgreSQL) z transakcyjnym lockowaniem i unikalnymi ograniczeniami.

Obecna implementacja lock-file jest bezpieczna dla pojedynczego wspoldzielonego storage, ale przy bardzo duzej skali i roznych storage backendach najlepsza praktyka to przeniesienie lockowania do bazy danych.
