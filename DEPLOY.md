# Deploying The Money Trials to Vercel

The app is ready to deploy: `next build` passes and `next.config.ts` makes sure the schema and the
deck are bundled. Three things only you can do, because they need your accounts and secrets.

## 1. Log in to Vercel (once)

```powershell
cd moneytrials
vercel login
```

## 2. Get a Postgres database

Vercel shows PGlite as unusable (read-only disk), so a real database is required. Easiest is Neon:
Vercel dashboard > Storage > Create > Neon (free tier). It gives you a connection string that
starts `postgres://` and ends `?sslmode=require`. Keep it to hand for step 3.

## 3. Create the project and set three environment variables

```powershell
vercel link
vercel env add DATABASE_URL production
vercel env add SESSION_SECRET production
vercel env add CRON_SECRET production
```

- `DATABASE_URL`: paste the Neon connection string.
- `SESSION_SECRET`: any long random string. Players are logged out if it ever changes.
- `CRON_SECRET`: any long random string. The daily rollover refuses to run without it.

A quick way to make a random string: `[guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")`

## 4. Deploy

```powershell
vercel --prod
```

Then open the URL, go to `/setup`, and create the real season (the players' names and PINs, you as
admin). The schema creates itself on the first request.

## Notes

- The cron in `vercel.json` runs at 05:00 UTC, which is 05:00 in winter and 06:00 in summer
  (British Summer Time). Vercel's free plan allows one daily cron.
- Nobody has run setup on the real site, so the first thing to do after deploying is `/setup`.
- The local `.data/` folder is the old test database and is not used on Vercel.

## Running it as the public demo

The same code runs as a demo with made-up players when `DEMO_MODE=1` is set:

- The login page shows the test logins (Robin 1111, Sam 2222, Dad 3333).
- `/setup` is closed, so visitors can't create a season.
- The daily cron wipes the database and seeds a fresh season with today in week 4
  (`src/lib/demo.ts`), so whatever visitors change is gone the next morning.

Deploy it as its own Vercel project with its own Neon database, never the one a real family plays on.
Set `DEMO_MODE` to `1` alongside the three variables above. To seed it the first time, call the cron
yourself:

```powershell
curl.exe -H "Authorization: Bearer <CRON_SECRET>" https://<your-domain>/api/cron/rollover
```
