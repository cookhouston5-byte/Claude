# Kalmvue

YouTube, minus the distractions. Kalmvue shows **only the newest videos from the channels you subscribe to**. There's no homepage, no recommendations, and no Shorts (unless you turn them on).

- **Subscriptions stay in sync.** Each refresh pulls your current subscription list from YouTube, so a channel you subscribe to on YouTube shows up here automatically.
- **Videos open on YouTube.** Creators get their views and YouTube shows its normal ads. Kalmvue never downloads or re-hosts anything.
- **Watched marks.** Opening a video marks it watched. Tap the circle to mark or unmark one yourself. Turn on "Hide watched" to clear finished videos from the list.
- **Shorts hidden by default**, with a toggle to show them.
- **Works on phone and computer.** On a phone, use "Add to Home Screen" and it opens like an app.
- **Private.** Read-only access to your YouTube account. Your watched list stays in your browser. Kalmvue has no database.

The other site in this repository is [FixFocus](fixfocus/README.md), a repair-and-how-to search. Setup for both is in **[SETUP.md](SETUP.md)**.

Live at **https://kalmvue.onrender.com** and, once connected, **https://kalmvue.com**. Until a Google Client ID is saved in `config.js`, visitors see a short "Coming soon" message.

## Files

| File | What it is |
|---|---|
| `index.html` | The page |
| `app.js` | Google sign-in, YouTube API calls, the feed, and watched marks |
| `styles.css` | Look and feel (light and dark mode) |
| `config.js` | The one place the Google Client ID goes |
| `privacy.html`, `terms.html` | Privacy policy and terms |
| `manifest.webmanifest`, `icon.svg` | Let you add it to your phone's home screen |

## How it works

1. You sign in with Google (read-only YouTube permission).
2. The page asks YouTube for your subscriptions again on every refresh. That list is not saved on its own, so a channel you just subscribed to is included the next time the feed loads.
3. For each channel, it fetches the newest uploads. It uses YouTube's "uploads without Shorts" list when Shorts are hidden.
4. The list is sorted newest first and kept in this browser so the page opens instantly. Opening the page, or coming back to it, reads your subscriptions from YouTube again. New videos are picked up about every 30 minutes while the tab is open, and **Refresh** checks immediately.

A refresh costs about 1 API unit per channel. Google gives each project 10,000 free units a day. FixFocus shares that same project, so a busy search day can leave fewer refreshes. See SETUP.md.
