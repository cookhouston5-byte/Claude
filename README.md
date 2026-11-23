# Focus Feed

YouTube, minus the distractions. Focus Feed shows **only the newest videos from the channels you subscribe to**. There's no homepage, no recommendations and no Shorts (unless you turn them on).

- **Auto-syncs your subscriptions.** Each refresh pulls your current subscription list from YouTube, so a channel you subscribe to on YouTube shows up here automatically.
- **Videos open on YouTube.** Creators get their views and YouTube shows its normal ads. Focus Feed never downloads or re-hosts anything.
- **✓ Watched checkmarks.** Opening a video marks it watched. Tap the circle to mark or unmark one yourself. Turn on "Hide watched" to clear finished videos from the list.
- **Shorts hidden by default**, with a toggle to show them.
- **Works on phone and computer.** On a phone, use "Add to Home Screen" and it opens like an app.
- **Private.** Read-only access to your YouTube account. Your watched list stays in your browser. There's no server and no database.

## Getting it running

See **[SETUP.md](SETUP.md)**. It takes about 15 minutes and is free.

## Files

| File | What it is |
|---|---|
| `index.html` | The page |
| `app.js` | All the logic: Google sign-in, YouTube API calls, the feed and checkmarks |
| `styles.css` | Look and feel (light and dark mode) |
| `config.js` | Where your Google Client ID goes |
| `manifest.webmanifest`, `icon.svg` | Let you add it to your phone's home screen |

## How it works

1. You sign in with Google (read-only YouTube permission).
2. The app asks YouTube's official Data API for your subscriptions.
3. For each channel, it fetches the newest uploads. It uses YouTube's "uploads without Shorts" list when Shorts are hidden.
4. Everything is sorted newest first and saved in your browser so it loads instantly next time.

A refresh costs about 1 API unit per channel. Google gives each project 10,000 free units a day, so a few hundred subscriptions can be refreshed dozens of times a day.
