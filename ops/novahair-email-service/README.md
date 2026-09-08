# NovaHair Email Service

Small Railway SMTP relay used by the NovaHair Concierge to send six-digit email
verification codes through Namecheap Private Email.

## Endpoints

- `GET /health`
- `POST /send-otp` with bearer authentication

## Required environment variables

- `NAMECHEAP_PRIVATE_EMAIL_USER`
- `NAMECHEAP_PRIVATE_EMAIL_PASSWORD`
- `NOVAHAIR_EMAIL_SERVICE_SECRET`

Optional variables:

- `NOVAHAIR_EMAIL_FROM`
- `NAMECHEAP_SMTP_HOST` (default `mail.privateemail.com`)
- `NAMECHEAP_SMTP_PORT` (default `465`)
- `PORT` (default `3000`)

Install and run:

```powershell
npm ci
npm start
```

Credentials belong in Railway environment variables only. This service is not a
marketing automation platform and must not be treated as a subscriber database.
