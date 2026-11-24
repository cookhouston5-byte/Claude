# FixFocus

YouTube, but **only videos that help you fix things**. Type what's broken, get repair and how-to videos, watch, fix it, leave. There's no homepage, no recommendations and no Shorts.

- **Fix videos only.** Every search becomes "how to fix …". Searches for distractions (music, gaming, pranks, trailers, vlogs…) are refused, and results are filtered so only repair/how-to videos show.
- **No rabbit holes.** Videos play inside FixFocus using YouTube's privacy-enhanced player, so there's no sidebar of recommended videos. Creators still get their views and YouTube shows its normal ads.
- **No Shorts.** Anything 60 seconds or shorter is dropped.
- **✓ "I fixed it".** Mark the video that solved your problem; it gets a checkmark next time you search.
- **Quick categories** (home, plumbing, car, phone, appliances…) and your recent searches.
- **Works on phone and computer.** Use "Add to Home Screen" and it opens like an app.
- **Private.** No sign-in, no server, no database. Your history stays in your browser.

## Getting it running

Live at **https://fixfocus.onrender.com**. To connect it to YouTube, see **[SETUP.md](SETUP.md)**. It takes about 5 minutes and is free.

## Files

| File | What it is |
|---|---|
| `index.html` | The page |
| `app.js` | Search, player, history and "fixed" checkmarks |
| `filter.js` | The rules for which searches and videos are allowed |
| `styles.css` | Look and feel (light and dark mode) |
| `config.js` | Where your YouTube API key goes |
| `manifest.webmanifest`, `icon.svg` | Let you add it to your phone's home screen |
| `test.js` | Tests for the filters: `node test.js` |

## How it works

1. You type what's broken, e.g. "dishwasher not draining".
2. FixFocus checks it isn't a distraction, then searches YouTube for "how to fix dishwasher not draining" (Safe Search on, embeddable videos only).
3. It keeps only videos whose title or description is about fixing, repairing, replacing, installing or troubleshooting, and drops Shorts and anything that looks like entertainment.
4. Results are saved in your browser for a day, so repeating a search is instant and free.

Each new search uses about 101 of the 10,000 free YouTube API units per day, so you get roughly 95 new searches a day.
