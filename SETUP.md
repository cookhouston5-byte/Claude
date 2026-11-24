# Setting up Kalmvue and FixFocus

You do these steps once. Visitors never see a setup form.

Kalmvue (https://kalmvue.onrender.com) is the subscription feed. It stays a free static site. The Google Client ID is public, so it lives in `config.js`. Until you save one, visitors see **Coming soon**.

FixFocus (https://fixfocus.onrender.com) is the repair search. The YouTube key must stay secret, so it lives only in Render, as an environment variable. Until that key is set, visitors see **Temporarily unavailable**.

Both sites already have a privacy policy and terms:

- https://kalmvue.onrender.com/privacy.html
- https://kalmvue.onrender.com/terms.html
- https://fixfocus.onrender.com/privacy.html
- https://fixfocus.onrender.com/terms.html

The FixFocus links start working for sure after Part 5. Before that, the old static site may already show them once this update is on `main`.

Use the same Google account you use for YouTube. Sign in to Google Cloud, GitHub, and Render with accounts you control.

One Google Cloud project is shared by both sites. Google gives that project 10,000 free units a day.

- A FixFocus search costs about 101 units. The server stops around 90 new searches a day so the allowance is not used up in one burst. Repeating a search is free while the result is still remembered.
- A Kalmvue refresh costs about 1 unit per subscribed channel.
- If the shared limit ever gets in the way, you can make a second Google project later and put only the FixFocus key in that one. You do not need to do that now.

---

## Part 1. Create the Google Cloud project and turn on YouTube

1. Open **https://console.cloud.google.com/** and sign in.
2. Create a project. Click the project picker at the top (it may say "Select a project"), then **New Project**. Name it `Kalmvue`. Click **Create**. Wait until it finishes, then make sure that project is the one selected in the top bar.
3. Turn on the API. Open **https://console.cloud.google.com/apis/library/youtube.googleapis.com** (YouTube Data API v3). Click **Enable**. If you see **Manage** instead of Enable, it is already on.

---

## Part 2. Create the YouTube API key (FixFocus)

1. Open **https://console.cloud.google.com/apis/credentials**.
2. Click **Create credentials**, then **API key**.
3. Copy the key somewhere private on your own computer, such as a notes app you lock, or a password manager. It usually starts with `AIza`.
4. Click **Edit API key** (or the key's name) and set both restrictions:
   - **Name:** `FixFocus server`
   - **Application restrictions:** **None**.
   - **API restrictions:** **Restrict key**, then tick **YouTube Data API v3** only. Untick everything else.
5. Click **Save**. Keys can take about 5 minutes to start working.

Why "None" for application restrictions: this key is used by the FixFocus server, not by someone's browser. Render's free plan does not keep a fixed network address, so an IP restriction would break the site the next time it wakes up. A "Websites" restriction would also break it, because the browser never calls YouTube directly.

Do not paste this key into `config.js`, into GitHub, or into a screenshot you post anywhere. If it leaks, come back to this page, delete the key, create a new one, and update the Render variable in Part 5.

---

## Part 3. Set up Google sign-in (Kalmvue)

The console page may be titled **OAuth consent screen** or **Google Auth Platform**. The fields are the same.

1. Open **https://console.cloud.google.com/auth/overview**. If that page asks you to get started, do that.
2. App information:
   - **App name:** `Kalmvue`
   - **User support email:** your email
3. **Audience:** **External**.
4. **Contact email:** your email. Agree to the policy if asked, then save or create.
5. Add yourself as a tester. Find **Audience**, then **Test users**, then **Add users**. Enter the Gmail address you will sign in with. Leave the app in **Testing**. In Testing, only people on that list can sign in (up to 100). Google does not have to review the app yet.
6. Add the YouTube permission. Find **Data Access** (it may be called Scopes). Choose **Add or remove scopes**. Search for `youtube.readonly`. Tick **`.../auth/youtube.readonly`** (YouTube Data API v3, "View your YouTube account"). Save. Do not add any other YouTube permission. A broader one makes Google's later review much heavier.
7. Create the Client ID. Open **Clients** (or, on the Credentials page, **Create credentials** > **OAuth client ID**).
   - **Application type:** **Web application**
   - **Name:** `Kalmvue web`
   - **Authorized JavaScript origins.** Add these exactly, with no slash at the end and no path:
     - `https://kalmvue.onrender.com`
     - `https://kalmvue.com`
     - `https://www.kalmvue.com`
     - `https://fixfocus.app`
     - `http://localhost:8000`
   - Leave **Authorized redirect URIs** empty.
   - Click **Create**.
8. Copy the **Client ID**. It looks like `1234567890-abcdefg.apps.googleusercontent.com`. This value is not a secret. It is safe to put in the website.

`https://fixfocus.app` is in that list because the domain is yours, alongside the Kalmvue addresses. FixFocus itself does not ask anyone to sign in. The sign-in button only runs on Kalmvue.

You can skip the logo. A logo makes Google's brand review stricter, and the site does not need one.

---

## Part 4. Put the Client ID on Kalmvue

Kalmvue on Render is already a static site that updates itself when `main` changes. Do not change that service into a web service.

1. Open **https://github.com/cookhouston5-byte/Claude/blob/main/config.js** while you are signed in to GitHub.
2. Click the pencil (**Edit this file**).
3. Change only the empty quotes. Paste your Client ID between them:

```js
window.KALMVUE_CONFIG = {
  clientId: "1234567890-abcdefg.apps.googleusercontent.com",
};
```

4. Click **Commit changes**. Leave the branch as `main`.
5. Wait a minute or two. Render rebuilds Kalmvue on its own.
6. Open **https://kalmvue.onrender.com** in a private window.
   - You should see **Sign in with Google**.
   - You should not see a box asking for a Client ID.
   - You should not see "Coming soon".
7. Click **Sign in with Google** and use the Gmail address you added as a test user. Google will say it has not verified the app. That is expected while the app is in Testing. Click **Advanced**, then the link that continues to Kalmvue (Google often words it "Go to Kalmvue (unsafe)"). "Unsafe" is Google's label for every unreviewed app. It is your own site.
8. Allow the read-only YouTube permission. Your subscriptions should appear. If you have none, the page says so and asks you to subscribe on YouTube, then tap Refresh.

Open **Privacy** and **Terms** in the footer once, so you know those pages load. Google will ask for the privacy link later.

---

## Part 5. Turn FixFocus into a free web service

Render cannot convert a static site into a web service. You create a new web service, then retire the old one. The name `fixfocus` is what makes the address `fixfocus.onrender.com`, so the old site has to give that name up first.

1. Open **https://dashboard.render.com**.
2. Open the existing **fixfocus** static site.
3. Go to **Settings**. Change the **Name** from `fixfocus` to `fixfocus-old`. Save. The old address changes. That is what frees `fixfocus.onrender.com`.
4. Click **New +**, then **Web Service**.
5. Connect the same GitHub repository (`cookhouston5-byte/Claude`) if Render asks. Branch: **main**.
6. Use these settings. Names must match, including capitals in the variable name.

| Setting | Value |
|---|---|
| Name | `fixfocus` |
| Region | Oregon (US West) is fine |
| Branch | `main` |
| Root Directory | `fixfocus` |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance type | Free |
| Health Check Path | `/api/status` |
| Auto-Deploy | On (every commit to `main`) |

7. Add environment variables before you finish creating it, under **Advanced** or **Environment**:

| Key | Value |
|---|---|
| `YOUTUBE_API_KEY` | The key from Part 2. Mark it secret if Render offers that. |
| `NODE_VERSION` | `22` |

8. Click **Create Web Service**. The first build takes a few minutes. Wait until the status says **Live**. The log line should say `FixFocus listening on ... (ready)`. If it says `missing YOUTUBE_API_KEY`, the variable name is wrong or the value is empty. Fix it and use **Manual Deploy** > **Deploy latest commit**.
9. Open **https://fixfocus.onrender.com**.
   - You should see **What needs fixing?**
   - You should not see a box asking for an API key.
10. Connect **fixfocus.app** as well as the onrender.com address. In the new FixFocus service, go to **Settings** > **Custom Domains** > **Add Custom Domain** and add `fixfocus.app`. Render adds `www.fixfocus.app` for you. In the domain's DNS settings, add the records Render shows. They are usually:

| Type | Name / Host | Value |
|---|---|---|
| `A` | `@` | `216.24.57.1` |
| `CNAME` | `www` | `fixfocus.onrender.com` |

`.app` addresses only work with HTTPS. Render turns that on after you click **Verify**. Use the values on Render's page if they differ. The site will answer at both **https://fixfocus.onrender.com** and **https://fixfocus.app**.
11. Search for `leaky faucet`. You should get repair videos. A repeated search should be fast.
12. Open **Privacy** and **Terms** in the footer.
13. When the new site works, delete the **fixfocus-old** static site so you are not looking at two of them. In that service: **Settings** > **Delete Web Service** (the wording may say Delete Static Site).

`render.yaml` in the repository root is a written copy of this same setup. Do not use **New Blueprint** or apply that file while a static site is still named `fixfocus`. Render would try to reconfigure the static site, and it cannot change a static site into a web service.

The free web service sleeps after about 15 minutes with no visitors. The first visit after that can take up to a minute while it wakes. That is normal. The page still works once it is awake.

---

## Part 6. What you should see when you are done

| Site | Visitor who has not signed in | What you did |
|---|---|---|
| Kalmvue | A sign-in button. No setup form. | Client ID in `config.js` |
| FixFocus | A search box. No setup form. | `YOUTUBE_API_KEY` on the web service |

Friends can use FixFocus right away. They can use Kalmvue only if you add their Gmail address under **Test users**, until Google finishes the review in Part 7.

---

## Part 7. Letting any Google user sign in

`youtube.readonly` is a **sensitive** scope. Google reviews it before the general public can click Allow. You do not pay for that review. You also do not want the heavier security audit. That audit is for broader YouTube permissions, which is why Part 3 says to add only `youtube.readonly`.

Until the review is done, keep the app in **Testing** and add people as test users.

Google will not treat `onrender.com` as your domain, because Render owns it. The domains for these sites are **kalmvue.com** and **fixfocus.app**. Sign-in for everyone has to use kalmvue.com. fixfocus.app is the public address for the repair search.

If either name is not registered yet, register it (porkbun.com or Cloudflare Registrar, auto-renew on, skip hosting add-ons) and then do the DNS steps below.

**Kalmvue custom domain.** Open the **kalmvue** static site, then **Settings** > **Custom Domains** > **Add Custom Domain**. Add `kalmvue.com`. Render adds `www.kalmvue.com`. In DNS:

| Type | Name / Host | Value |
|---|---|---|
| `A` | `@` | `216.24.57.1` |
| `CNAME` | `www` | `kalmvue.onrender.com` |

The site then answers at **https://kalmvue.onrender.com**, **https://kalmvue.com**, and **https://www.kalmvue.com**.

**FixFocus custom domain.** If you did not already add it in Part 5, open the **fixfocus** web service, **Settings** > **Custom Domains**, and add `fixfocus.app`. In DNS:

| Type | Name / Host | Value |
|---|---|---|
| `A` | `@` | `216.24.57.1` |
| `CNAME` | `www` | `fixfocus.onrender.com` |

The site then answers at **https://fixfocus.onrender.com** and **https://fixfocus.app**. `.app` only works over HTTPS, which Render sets up.

Delete any parking records for `@` or `www` first. Use the values on each service's Custom Domains page if they differ. It often works within minutes and can take a few hours. Click **Verify** on each domain. Render turns on HTTPS.

**Prove to Google that you own them.**

1. Open **https://search.google.com/search-console** with the same Google account that owns the Cloud project.
2. Add the property `kalmvue.com` and finish the DNS check. Also add `fixfocus.app` and finish its check, because that address is an Authorized JavaScript origin.
3. On the OAuth consent screen, set:
   - **Authorized domains:** `kalmvue.com` and `fixfocus.app`
   - **App home page:** `https://kalmvue.com`
   - **Privacy policy:** `https://kalmvue.com/privacy.html`
   - **Terms of service:** `https://kalmvue.com/terms.html`
4. Confirm the Client ID's **Authorized JavaScript origins** are exactly:
   - `https://kalmvue.onrender.com`
   - `https://kalmvue.com`
   - `https://www.kalmvue.com`
   - `https://fixfocus.app`
   - `http://localhost:8000` (only if you still want to try Kalmvue on your own computer)
5. The privacy link in the Kalmvue footer must be the same URL you give Google.

**Submit the review.**

1. In the Google Cloud console, find **Verification center** or the button that publishes the app (moves it from Testing to **In production**).
2. Submit verification for the sensitive scope. Google will ask why you need it. A plain answer is enough: Kalmvue reads the signed-in person's subscriptions and the latest videos on those channels so it can show a feed with no recommendations. No narrower YouTube permission can see subscriptions. The app does not write anything to the account.
3. Google often asks for a short unlisted YouTube video: click Sign in, show the Google consent screen, then show the subscription list. Film that when they ask.
4. Watch the inbox of the support email you entered, including spam. Reply if they ask questions.
5. Sensitive-scope review often takes several days. Google's own note says it can take up to about 10 days, and longer if they have questions.

After approval, any Google user can sign in, and the "unverified app" warning goes away. If Google asks you to remove `https://kalmvue.onrender.com` from the JavaScript origins because you do not own `onrender.com`, remove it and use the custom domain as the public address.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| Kalmvue says "Coming soon" | The Client ID in `config.js` on `main` is still empty, or Render has not finished rebuilding. Check the file, then the kalmvue service's latest deploy. |
| "Error 400: origin_mismatch" or "redirect_uri_mismatch" | The address in the browser bar is not in Part 3's JavaScript origins. Add it exactly, with `https://`, and with no slash at the end. |
| "Access blocked: app has not completed verification" | That Google account is not a test user. Add it in Part 3, or wait until Part 7 is approved. |
| Sign-in popup never appears | Allow popups for the site. |
| "Your Google sign-in expired" | Tap **Refresh**. The sign-in lasts about an hour. |
| "You're not subscribed to any channels yet" | That Google account has no subscriptions. Subscribe on YouTube, then tap Refresh. |
| "YouTube's daily limit for Kalmvue was reached" | The shared 10,000 units are used up. It resets at midnight Pacific time. Videos already on the page stay there. |
| FixFocus says "Temporarily unavailable" | `YOUTUBE_API_KEY` is missing, mistyped, or still restricted to websites. Check Part 2 and Part 5. The log should say `ready`, not `missing YOUTUBE_API_KEY`. |
| "FixFocus has used today's YouTube search allowance" | The daily units are gone, or the server's own daily cap was hit. It resets at midnight Pacific time. Searches already made still work. |
| "You've used today's search limit for this connection" | That network has made enough new searches for one day. Repeats of earlier searches still work. |
| "Too many searches in a short time" | Wait a minute. This stops a burst from using the daily allowance. |
| A video says "Video unavailable" | The uploader blocked playback on other sites. Use **Open on YouTube**. |
| First visit to FixFocus sits there for a minute | The free service was asleep. Wait for it to wake up. |

## Run them on your own computer (optional)

Kalmvue, from the repository folder:

```bash
python3 -m http.server 8000
```

Open http://localhost:8000. That address is already in the JavaScript origins list above.

FixFocus:

```bash
cd fixfocus
YOUTUBE_API_KEY=paste-the-key-here npm start
```

Open http://localhost:8000. Use a different port (`PORT=8001 npm start`) if Kalmvue is already using 8000.
