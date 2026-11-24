# Setting up FixFocus

The site is online at **https://fixfocus.onrender.com**. You'll do two things: **create a free YouTube API key**, and **paste it into the site**. About 5 minutes, no cost, and no sign-in needed afterwards.

---

## Step 1: Create a Google Cloud project

1. Go to **https://console.cloud.google.com/** and sign in with any Google account.
2. Click the project picker at the top → **New Project**. Name it `FixFocus` → **Create**, and make sure it's selected.
   (Use its own project rather than Lock-Tube's, so the two apps don't share one daily limit.)

## Step 2: Turn on the YouTube API

Search the top bar for **"YouTube Data API v3"**, open it and click **Enable**.

## Step 3: Create the API key

1. Go to **APIs & Services → Credentials → Create credentials → API key**. Copy the key (it starts with `AIza`).
2. Click **Edit API key** (or the key's name) to lock it down so nobody else can use it:
   - **Application restrictions:** choose **Websites**, then add:
     - `https://fixfocus.onrender.com/*`
     - Optionally `http://localhost:8000/*` to run it on your own computer.
   - **API restrictions:** choose **Restrict key** and tick **YouTube Data API v3**.
   - Click **Save**. It can take up to 5 minutes to start working.

## Step 4: Connect it

**Easiest:** open https://fixfocus.onrender.com, paste the key into the setup box and click **Save**. Your browser remembers it, so do this once on each device.

**Or set it once for every device:** put the key in `config.js`:

```js
window.FIXFOCUS_CONFIG = {
  apiKey: "AIzaSy...",
};
```

Because the key only works on your FixFocus address (step 3), it's safe for it to be in the site's code.

---

## Using it

- Type what's broken and press **Search**. You don't need to type "how to fix"; FixFocus adds it.
- Tap a category for a head start, then describe the problem.
- Tap a video to watch it right there. Tap **✓ I fixed it** when it worked.
- **On your phone:** open the site in Safari (iPhone) or Chrome (Android), **Share → Add to Home Screen**.

## Troubleshooting

| Message / problem | Fix |
|---|---|
| "This API key isn't allowed on this website" | Step 3.2: the website must be exactly `https://fixfocus.onrender.com/*`. Wait 5 minutes after saving. |
| "The YouTube Data API v3 isn't enabled" | Do step 2 in the same project as the key. |
| "That API key isn't valid" | Copy the key again from Credentials, then ⋯ → Change API key. |
| "Daily search limit reached" | Resets at midnight Pacific time. Searches you've already made still work. |
| A video says "Video unavailable" | The uploader blocked playback on other sites. Use **Open on YouTube**. |
