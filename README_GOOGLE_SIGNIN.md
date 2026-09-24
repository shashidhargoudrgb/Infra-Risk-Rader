# Google Sign-In setup

1. Create a Google Cloud Web OAuth client.
2. Put the same client ID in `frontend/.env` as `VITE_GOOGLE_CLIENT_ID`.
3. Put the same client ID in `backend/.env` as `GOOGLE_CLIENT_ID`.
4. Set `GOOGLE_ADMIN_EMAILS` to a comma-separated allowlist of Google emails permitted to request Administrator access.
5. Start the backend and frontend again after changing `.env`.
6. In Google Cloud, add your deployed origin to Authorized JavaScript origins. For a GIS credential flow, use the exact production domain and local development origin you actually use.

For this local Vite frontend, add `http://localhost:3000` as an Authorized JavaScript origin. This implementation uses the Google Identity Services credential callback, not a redirect callback, so no Google OAuth redirect URI is required by the existing code.

## Roles

- General User: any verified Google account can sign in as General User.
- Administrator: the Google email must be in `GOOGLE_ADMIN_EMAILS` and the existing Administrator Key is also required.
- Google authentication is verified on the backend; the frontend does not decide whether a user is an Administrator.

Never commit `.env` files containing credentials.

## Local example

Create `backend/.env` from `backend/.env.example` and `frontend/.env` from `frontend/.env.example`. The backend now loads its `.env` directly when it starts, so no extra dotenv package is required.

For production, configure the same Google Web Client ID on both sides and set the exact deployed frontend origin in Google Cloud.
