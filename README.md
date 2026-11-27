# Jarvis

A voice assistant web app in the style of J.A.R.V.I.S. from Iron Man, built for Safari on iPad. It's a static site (plain HTML/CSS/JS, no build step), so it runs on GitHub Pages.

## Features

- **Tap-to-talk core**: tap the glowing button and speak. Tap again to stop listening, or to interrupt Jarvis while he's speaking.
- **Gemini brain**: what you say goes to the Google Gemini API (free tier) along with the recent conversation history.
- **Spoken replies**: uses the browser's speech synthesis and picks a British English voice (e.g. Daniel or Arthur) when one is installed. You can change the voice and speed in Settings.
- **Safari control**: these commands are handled locally and open a new tab:
  - "open YouTube", "go to reddit", "take me to github.com"
  - "search for cats", "google best pizza near me", "look up the weather in London"
  - "play lofi beats" / "search YouTube for …"
  - "search Reddit / Wikipedia / Amazon for …", "directions to the airport"
- **Type instead**: there's a text box under the log if you'd rather not speak.
- **Your key stays with you**: the Gemini API key is pasted into Settings and stored only in your browser's `localStorage`. It is never in the code.

## Setup

1. Get a free Gemini API key at <https://aistudio.google.com/apikey>.
2. Turn on GitHub Pages: repo **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**.
3. Open `https://<your-username>.github.io/Jarvis/` in Safari on the iPad.
4. Tap the gear icon (top right), paste the key, and press **Save**.
5. Tap the core and talk.

## iPad tips

- **Microphone**: speech recognition in Safari needs **Settings → Apple Intelligence & Siri** (or **Siri & Search**) and **Settings → General → Keyboard → Enable Dictation** turned on. Allow microphone access when Safari asks.
- **New tabs**: Safari only lets a page open tabs directly after a tap. Jarvis hears you after the tap has ended, so Safari may hold the tab back. When that happens a **tap to open** button appears. To open tabs straight away, turn off **Settings → Apps → Safari → Block Pop-ups**.
- **Better voice**: download a higher-quality British voice in **Settings → Accessibility → Spoken Content → Voices → English → Voice** (for example *Daniel (Enhanced)*), then pick it in Jarvis's settings.
- **Model**: the default is `gemini-flash-latest`. If Google renames its models, change it in Settings (e.g. `gemini-2.5-flash`).

## Files

- `index.html`: page layout
- `style.css`: the HUD look
- `app.js`: speech recognition, Gemini calls, speech synthesis and the Safari commands
