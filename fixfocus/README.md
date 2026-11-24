# FixFocus

YouTube, but **only videos that help you fix things**. Type what's broken, get repair and how-to videos, watch, fix it, leave. There's no homepage, no recommendations, and no Shorts.

- **Fix videos only.** Every search becomes "how to fix ...". Searches for distractions (music, gaming, pranks, trailers, vlogs, and the like) are refused, and results are filtered so only repair and how-to videos show.
- **No rabbit holes.** Videos play inside FixFocus using YouTube's privacy-enhanced player, so there's no sidebar of recommended videos. Creators still get their views and YouTube shows its normal ads.
- **No Shorts.** Anything 60 seconds or shorter is dropped.
- **"I fixed it".** Mark the video that solved your problem. It is marked the next time you search.
- **Quick categories** (home, plumbing, car, phone, appliances, and more) and your recent searches.
- **Works on phone and computer.** Use "Add to Home Screen" and it opens like an app.
- **No accounts.** You don't sign in. Recent searches stay in your browser. The YouTube key stays on the server, in the `YOUTUBE_API_KEY` environment variable, and is never sent to the browser.

Live at **https://fixfocus.onrender.com** and, once connected, **https://fixfocus.app**. Setup for the owner is in the repository's **[SETUP.md](../SETUP.md)**. If the key is missing, visitors see "Temporarily unavailable". They are never asked for a key.

## Files

| File | What it is |
|---|---|
| `server.js` | Serves the site and `GET /api/search`. Holds the YouTube key. |
| `package.json` | Start and test commands. No extra packages. |
| `index.html` | The page |
| `app.js` | Search, player, history, and "I fixed it" |
| `filter.js` | The rules for which searches and videos are allowed |
| `styles.css` | Look and feel (light and dark mode) |
| `privacy.html`, `terms.html` | Privacy policy and terms |
| `manifest.webmanifest`, `icon.svg` | Let you add it to your phone's home screen |
| `test.js`, `server.test.js` | Tests. From this folder: `npm test` |

The Render settings that match this folder are in `render.yaml` at the repository root.

## How it works

1. You type what's broken, for example "dishwasher not draining".
2. FixFocus checks it isn't a distraction, then asks its own server to search.
3. The server searches YouTube for "how to fix dishwasher not draining" (Safe Search on, embeddable videos only).
4. It keeps only videos whose title or description is about fixing, repairing, replacing, installing, or troubleshooting, and drops Shorts and anything that looks like entertainment.
5. Identical searches are remembered on the server for about a day, and again in your browser, so repeating one does not spend the daily allowance.

Each new search uses about 101 of the 10,000 free YouTube API units per day. The server stops itself at about 90 new searches a day and limits how many one visitor can make. Kalmvue uses the same Google project, so the two sites share that daily allowance.

## Run it locally

```bash
cd fixfocus
YOUTUBE_API_KEY=your-key-here npm start
```

Open http://localhost:8000. With no key set, the page says it is temporarily unavailable.
