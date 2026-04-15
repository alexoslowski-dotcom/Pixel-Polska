# Deploy produkcyjny na VPS (Docker + HTTPS)

Ten projekt zawiera gotowy stack:

- aplikacja Next.js w kontenerze,
- reverse proxy Caddy (automatyczne SSL z Let's Encrypt),
- trwały wolumen na dane (`/app/data`).

## 1. Wymagania

- VPS z publicznym IP (Ubuntu 22.04+ lub podobny),
- domena skierowana rekordem `A` na IP VPS,
- zainstalowany Docker i Docker Compose plugin.

## 2. Przygotowanie `.env.production`

W katalogu projektu:

```bash
cp .env.production.example .env.production
```

Ustaw prawidłowe wartości:

- `NEXT_PUBLIC_APP_URL=https://twoja-domena.pl`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `IMAGE_MODERATION_MODE=enforce`
- `OPENAI_API_KEY`

## 3. Ustawienia dla Caddy (domena + email ACME)

Przed startem ustaw zmienne środowiskowe shella:

```bash
export DOMAIN=twoja-domena.pl
export ACME_EMAIL=twoj@email.pl
```

## 4. Start produkcji

```bash
cd deploy
docker compose -f docker-compose.prod.yml up -d --build
```

Sprawdzenie:

```bash
docker compose -f docker-compose.prod.yml ps
curl -I https://twoja-domena.pl/api/health
```

## 5. Stripe webhook

W Stripe Dashboard ustaw endpoint:

`https://twoja-domena.pl/api/payments/webhook`

Zdarzenia:

- `checkout.session.completed`
- `checkout.session.expired`

Następnie skopiuj secret webhooka do `STRIPE_WEBHOOK_SECRET` i zrestartuj:

```bash
cd deploy
docker compose -f docker-compose.prod.yml up -d
```

## 6. Aktualizacja po zmianach kodu

```bash
cd deploy
docker compose -f docker-compose.prod.yml up -d --build
```

## 7. Logi

```bash
cd deploy
docker compose -f docker-compose.prod.yml logs -f app
docker compose -f docker-compose.prod.yml logs -f caddy
```
