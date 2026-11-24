# Setting up Kalmvue

The site is already online at **https://kalmvue.onrender.com**. What's left: **connect your own domain** (optional, about 10 minutes plus waiting), **create a free Google "sign-in key"** (a Client ID), and **paste the key into the site**.

---

## Step 1: Put the site online ✅ (already done)

Kalmvue is hosted for free on Render at **https://kalmvue.onrender.com**.
Whenever the `main` branch on GitHub changes, Render updates the site automatically.

---

## Step 1b: Connect kalmvue.com (optional)

**Buy the domain.** Go to **porkbun.com** or **cloudflare.com** (Domain Registration), search for `kalmvue.com`, and check out. It's about $10–12 a year. Turn on **auto-renew** so nobody can grab it if it lapses. Skip add-ons like email and hosting. Buying `kalmvue.app` too is optional but protects the name.

**Tell Render about it.** Go to **dashboard.render.com**, open the **kalmvue** site, then **Settings → Custom Domains → Add Custom Domain**. Add `kalmvue.com`. Render adds `www.kalmvue.com` automatically.

**Point the domain at Render.** In your domain seller's **DNS** settings, add these two records. Render's Custom Domains page shows the exact values, so use those if they differ.

| Type | Name / Host | Value |
|---|---|---|
| `A` | `@` (the bare domain) | `216.24.57.1` |
| `CNAME` | `www` | `kalmvue.onrender.com` |

If your seller added default "parking" records for `@` or `www`, delete those first.

**Wait.** It usually works within minutes but can take up to a few hours. Back in Render, click **Verify**. Render then sets up the secure padlock (HTTPS) for you, for free.

---

## Step 2: Create your Google Client ID

1. Go to **https://console.cloud.google.com/** and sign in with the **same Google account you use for YouTube**.
2. **Create a project.** Click the project picker at the top, then **New Project**. Name it something like `Kalmvue` and click **Create**. Make sure it's selected afterward.
3. **Turn on the YouTube API.** Search the top bar for **"YouTube Data API v3"**, open it and click **Enable**.
4. **Set up the sign-in screen.** In the left menu, go to **APIs & Services → OAuth consent screen**. This may be called **Google Auth Platform**. Click **Get started**.
   - App name: `Kalmvue`. Support email: your email.
   - Audience: **External**.
   - Contact email: your email. Agree to the policy, then click **Create**.
5. **Add yourself as a tester.** Go to **Audience → Test users → Add users** and enter your Gmail address. Leave the app in **Testing** mode. That means only you (and up to 100 people you add) can use it, and Google doesn't need to review it.
6. **Allow YouTube read access.** Go to **Data Access → Add or remove scopes**, search for `youtube.readonly`, tick it, then click **Update** and **Save**.
7. **Create the key.** Go to **Clients → Create client**.
   - Application type: **Web application**
   - Name: `Kalmvue web`
   - Under **Authorized JavaScript origins**, add each address you'll open the site from, exactly like this (no slash at the end):
     - `https://kalmvue.onrender.com`
     - `https://kalmvue.com` and `https://www.kalmvue.com` (once you own the domain; you can add these later)
     - Optionally add `http://localhost:8000` if you want to run it on your own computer.
   - Leave "Authorized redirect URIs" empty. Click **Create**.
8. Copy the **Client ID**. It looks like `1234567890-abcdefg.apps.googleusercontent.com`.

---

## Step 3: Connect it

**Easiest:** open your site, paste the Client ID into the setup box and click **Save**. Your browser remembers it, so you'll repeat this once on each device (phone, computer).

**Or set it once for every device:** edit `config.js` and put the ID between the quotes:

```js
window.KALMVUE_CONFIG = {
  clientId: "1234567890-abcdefg.apps.googleusercontent.com",
};
```

Then click **Sign in with Google**. You'll see a warning that *"Google hasn't verified this app."* That's expected for your own personal app in Testing mode. Click **Continue** and allow read-only YouTube access.

---

## Using it

- **Refresh** pulls your current subscriptions and their newest videos. New subscriptions appear here automatically.
- Google sign-ins last about an hour. After that, tapping **Refresh** briefly flashes a Google window to sign you back in.
- Tap a video to watch it on YouTube. It gets a ✓ automatically. Tap the circle to mark or unmark one yourself.
- **Hide watched** clears out finished videos. **Show Shorts** brings Shorts back.
- **On your phone:** open the site in Safari (iPhone) or Chrome (Android), choose **Share → Add to Home Screen**, and it opens like an app.

## Troubleshooting

| Message / problem | Fix |
|---|---|
| "Error 400: redirect_uri_mismatch" or "origin_mismatch" | The address you're on isn't listed in step 2.7. Add it exactly as it appears in your browser's address bar (for example `https://kalmvue.com`), with no slash at the end. |
| "Access blocked: app has not completed verification" | You're signed in with a Google account that isn't a test user. Add it in step 2.5. |
| "YouTube Data API v3 isn't enabled" | Do step 2.3. |
| Sign-in popup doesn't appear | Allow popups for your site in the browser settings. |
| "Daily API limit reached" | It resets at midnight Pacific time. Refreshing less often helps. |
