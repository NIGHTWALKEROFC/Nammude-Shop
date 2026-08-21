# Free push notifications (no Blaze plan, no billing card)

This makes real phone-popup push notifications actually arrive, without
ever attaching a billing card to Firebase. It works entirely from GitHub —
no computer needed, the GitHub mobile app or mobile browser is enough.

## How it works

Every 5 minutes, GitHub Actions runs `index.js` in this folder. It checks
Firestore for anything waiting to be pushed (a new customer announcement,
or a new order for the shop owner), sends it through Firebase Cloud
Messaging using an admin service account, and marks it as sent. This is
the same job `functions/index.js` was written to do — just run on a
schedule instead of by Cloud Functions, so it never needs the Blaze plan.

## One-time setup (do this once)

1. **Get a service account key.**
   Firebase Console → ⚙️ Project settings → **Service accounts** tab →
   **Generate new private key**. This downloads a `.json` file. Treat it
   like a master password — it can read and write your entire database.
   Never commit it to the repo, never share it, never paste it anywhere
   except step 2 below.

2. **Add it as a GitHub Actions secret.**
   On the repo → **Settings** → **Secrets and variables** → **Actions** →
   **New repository secret**.
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Value: paste the *entire contents* of the JSON file you downloaded.
   Save.

3. **(Optional) If you ever host more than one shop from this project**,
   also add a repository secret named `SHOP_ID` with your shop's ID
   (defaults to `main`, which matches `shared/js/firebase-config.js`).

4. That's it. The workflow in `.github/workflows/send-push.yml` is already
   set to run automatically every 5 minutes, and you can also trigger it
   manually any time from the repo's **Actions** tab → **Send Push
   Notifications** → **Run workflow** — handy for testing right after
   setup, works fine from the GitHub mobile app.

## Checking it's working

- Actions tab → **Send Push Notifications** → click a recent run → view
  the log. It prints how many notifications/order alerts it sent.
- If a run fails immediately with a credentials error, double-check the
  `FIREBASE_SERVICE_ACCOUNT` secret has the *full* JSON pasted in exactly
  as downloaded (no extra quotes, nothing trimmed).

## If you later decide to attach a billing card

You can delete this folder and `.github/workflows/send-push.yml`, deploy
`functions/index.js` instead, and get instant (not every-5-minutes) push
delivery. Both approaches send through the same Firebase Cloud Messaging
project, so nothing else about the app needs to change.
