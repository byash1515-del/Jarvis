/* J.A.R.V.I.S. — voice assistant for Safari on iPad.
 * The Gemini API key lives only in this browser's localStorage. */
(() => {
  "use strict";

  // ---------- Storage ----------
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem("jarvis." + k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("jarvis." + k, v); } catch {} },
    del(k) { try { localStorage.removeItem("jarvis." + k); } catch {} },
  };

  const DEFAULT_MODEL = "gemini-flash-latest";
  const MAX_TURNS = 24; // messages kept in history sent to Gemini

  const SYSTEM_PROMPT = `You are J.A.R.V.I.S., the AI butler from the Iron Man films, now serving the user as their personal voice assistant.
Personality: impeccably polite, calm, quietly witty, dry British humour, unflappable and supremely competent.
Always address the user as "sir".
Your replies are spoken aloud by a text-to-speech voice, so:
- Keep answers brief: usually one to three sentences unless sir asks for detail.
- Never use markdown, bullet points, asterisks, emoji, code blocks or URLs. Write plain conversational sentences.
- Spell things the way they should be pronounced when helpful.
The app itself handles opening websites and Google searches in Safari. If sir asks you to do something you cannot do (such as controlling the device beyond opening web pages), say so gracefully and suggest what to say instead, for example "open YouTube" or "search for ...".
Current date and time: {{NOW}}.`;

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const talkBtn = $("talk-btn"), coreLabel = $("core-label"), statusEl = $("status"),
    interimEl = $("interim"), logEl = $("log"), linkStatus = $("link-status"),
    settingsDlg = $("settings"), apiKeyIn = $("api-key"), modelIn = $("model"),
    voiceSel = $("voice"), rateIn = $("rate"), rateVal = $("rate-val"), langIn = $("listen-lang"),
    linkCard = $("link-card"), linkCardText = $("link-card-text"), linkCardA = $("link-card-a");

  let history = []; // [{role:'user'|'model', parts:[{text}]}]
  let state = "idle";

  function setState(s, label) {
    state = s;
    document.body.dataset.state = s;
    talkBtn.dataset.state = s;
    const labels = { idle: "TAP TO TALK", listening: "LISTENING", thinking: "PROCESSING", speaking: "TAP TO STOP", error: "TAP TO TALK" };
    coreLabel.textContent = labels[s] || "TAP TO TALK";
    const statuses = { idle: "STANDING BY", listening: "LISTENING…", thinking: "ACCESSING NEURAL NET…", speaking: "SPEAKING", error: "ERROR" };
    statusEl.textContent = label || statuses[s] || "";
  }

  function log(who, text, cls) {
    const div = document.createElement("div");
    div.className = "msg " + cls;
    const w = document.createElement("span");
    w.className = "who";
    w.textContent = who;
    div.appendChild(w);
    div.appendChild(document.createTextNode(text));
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
    return div;
  }

  function updateLinkStatus() {
    const has = !!store.get("apiKey");
    linkStatus.textContent = has ? "ONLINE" : "NO KEY";
    linkStatus.classList.toggle("ok", has);
  }

  // Clock
  setInterval(() => { $("clock").textContent = new Date().toLocaleTimeString([], { hour12: false }); }, 1000);

  // ---------- Speech synthesis ----------
  const synth = window.speechSynthesis;
  let voices = [];
  let speakQueue = 0;

  function britishScore(v) {
    const n = (v.name || "").toLowerCase();
    let s = 0;
    if (/en[-_]gb/i.test(v.lang)) s += 100;
    else if (/^en/i.test(v.lang)) s += 10;
    if (/daniel|arthur|oliver|malcolm|google uk english male|uk english male/.test(n)) s += 40;
    if (/male/.test(n) && !/female/.test(n)) s += 5;
    if (/enhanced|premium|neural/.test(n)) s += 8;
    if (/compact/.test(n)) s -= 3;
    return s;
  }

  function loadVoices() {
    if (!synth) return;
    voices = synth.getVoices().filter((v) => /^en/i.test(v.lang));
    voices.sort((a, b) => britishScore(b) - britishScore(a));
    const saved = store.get("voice");
    voiceSel.innerHTML = "";
    if (!voices.length) {
      const o = document.createElement("option");
      o.textContent = "Default system voice";
      o.value = "";
      voiceSel.appendChild(o);
      return;
    }
    for (const v of voices) {
      const o = document.createElement("option");
      o.value = v.voiceURI;
      o.textContent = `${v.name} (${v.lang})`;
      voiceSel.appendChild(o);
    }
    voiceSel.value = saved && voices.some((v) => v.voiceURI === saved) ? saved : voices[0].voiceURI;
  }
  if (synth) {
    loadVoices();
    if ("onvoiceschanged" in synth) synth.onvoiceschanged = loadVoices;
    setTimeout(loadVoices, 500);
    setTimeout(loadVoices, 2000);
  }

  function pickVoice() {
    const uri = store.get("voice");
    return voices.find((v) => v.voiceURI === uri) || voices[0] || null;
  }

  function cleanForSpeech(text) {
    return text
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/[*_#`>~]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Safari can cut off long utterances, so speak sentence-sized chunks.
  function chunkText(text) {
    const sentences = text.match(/[^.!?;:]+[.!?;:]*\s*/g) || [text];
    const chunks = [];
    let cur = "";
    for (const s of sentences) {
      if ((cur + s).length > 180 && cur) { chunks.push(cur.trim()); cur = ""; }
      cur += s;
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks;
  }

  function speak(text) {
    return new Promise((resolve) => {
      if (!synth) return resolve();
      const clean = cleanForSpeech(text);
      if (!clean) return resolve();
      synth.cancel();
      const myId = ++speakQueue;
      const voice = pickVoice();
      const rate = parseFloat(store.get("rate", "1")) || 1;
      const chunks = chunkText(clean);
      setState("speaking");
      let i = 0;
      const next = () => {
        if (myId !== speakQueue) return resolve();
        if (i >= chunks.length) { if (state === "speaking") setState("idle"); return resolve(); }
        const u = new SpeechSynthesisUtterance(chunks[i++]);
        if (voice) { u.voice = voice; u.lang = voice.lang; } else { u.lang = "en-GB"; }
        u.rate = rate;
        u.pitch = 0.95;
        u.onend = next;
        u.onerror = next;
        synth.speak(u);
      };
      next();
    });
  }

  function stopSpeaking() {
    speakQueue++;
    if (synth) synth.cancel();
  }

  // iOS needs speech synthesis to be started from a user gesture once.
  let synthUnlocked = false;
  function unlockSynth() {
    if (synthUnlocked || !synth) return;
    synthUnlocked = true;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    synth.speak(u);
  }

  // ---------- Speech recognition ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let finalText = "";
  let interimText = "";
  let silenceTimer = null;
  let handledThisSession = false;

  function startListening() {
    if (!SR) {
      log("SYSTEM", "Speech recognition isn't available in this browser. On iPad, make sure you're using Safari and that Siri & Dictation are enabled in Settings. You can still type below.", "system");
      speak("I'm afraid I can't hear you in this browser, sir. You may type instead.");
      return;
    }
    stopSpeaking();
    finalText = ""; interimText = ""; handledThisSession = false;
    interimEl.textContent = "";

    rec = new SR();
    rec.lang = store.get("lang") || navigator.language || "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => setState("listening");
    rec.onresult = (e) => {
      let fin = "", inter = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) fin += r[0].transcript;
        else inter += r[0].transcript;
      }
      finalText = fin;
      interimText = inter;
      interimEl.textContent = (fin + " " + inter).trim();
      // Safari sometimes keeps listening; stop after a pause in speech.
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => { try { rec && rec.stop(); } catch {} }, 1600);
    };
    rec.onerror = (e) => {
      clearTimeout(silenceTimer);
      if (e.error === "no-speech" || e.error === "aborted") return;
      const msgs = {
        "not-allowed": "Microphone or speech recognition permission was denied. Allow it in Settings › Safari › Microphone, and enable Siri & Dictation.",
        "service-not-allowed": "Speech recognition isn't allowed. Enable Siri & Dictation in iPad Settings, then reload.",
        "network": "Speech recognition needs a network connection.",
        "audio-capture": "No microphone was found.",
      };
      log("SYSTEM", msgs[e.error] || ("Speech recognition error: " + e.error), "system");
      setState("error", "MIC ERROR");
    };
    rec.onend = () => {
      clearTimeout(silenceTimer);
      rec = null;
      if (handledThisSession) return;
      handledThisSession = true;
      const text = (finalText || interimText).trim();
      interimEl.textContent = "";
      if (text) handleInput(text);
      else if (state === "listening") setState("idle", "NOTHING HEARD");
    };

    try { rec.start(); setState("listening"); }
    catch (err) { log("SYSTEM", "Couldn't start listening: " + err.message, "system"); setState("idle"); }
  }

  function stopListening() {
    clearTimeout(silenceTimer);
    if (rec) { try { rec.stop(); } catch {} }
  }

  // ---------- Safari commands ----------
  const SITES = {
    youtube: "https://www.youtube.com", "you tube": "https://www.youtube.com",
    reddit: "https://www.reddit.com", google: "https://www.google.com",
    gmail: "https://mail.google.com", mail: "https://mail.google.com", email: "https://mail.google.com",
    "google maps": "https://maps.google.com", maps: "https://maps.google.com",
    "google drive": "https://drive.google.com", drive: "https://drive.google.com",
    "google docs": "https://docs.google.com", calendar: "https://calendar.google.com", "google calendar": "https://calendar.google.com",
    netflix: "https://www.netflix.com", amazon: "https://www.amazon.com",
    wikipedia: "https://www.wikipedia.org", twitter: "https://x.com", x: "https://x.com",
    facebook: "https://www.facebook.com", instagram: "https://www.instagram.com",
    github: "https://github.com", "git hub": "https://github.com", linkedin: "https://www.linkedin.com",
    spotify: "https://open.spotify.com", twitch: "https://www.twitch.tv", tiktok: "https://www.tiktok.com",
    pinterest: "https://www.pinterest.com", "the news": "https://news.google.com", news: "https://news.google.com",
    "bbc": "https://www.bbc.co.uk", "bbc news": "https://www.bbc.co.uk/news", weather: "https://weather.com",
    "the weather": "https://weather.com", chatgpt: "https://chatgpt.com", claude: "https://claude.ai",
    "apple": "https://www.apple.com", "ebay": "https://www.ebay.com", "disney plus": "https://www.disneyplus.com",
    "hulu": "https://www.hulu.com", "prime video": "https://www.primevideo.com", "espn": "https://www.espn.com",
    "whatsapp": "https://web.whatsapp.com", "discord": "https://discord.com/app", "outlook": "https://outlook.live.com",
    "translate": "https://translate.google.com", "google translate": "https://translate.google.com",
  };

  const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

  function siteUrl(name) {
    let n = name.toLowerCase().trim()
      .replace(/^(the\s+)?(website|site|page)\s+/, "")
      .replace(/\s+(website|site|web site|page|app|dot com)$/, (m) => (m.includes("dot com") ? ".com" : ""))
      .replace(/\s+dot\s+/g, ".")
      .replace(/[.!?]+$/, "")
      .trim();
    if (!n) return null;
    if (SITES[n]) return SITES[n];
    if (/^https?:\/\//.test(n)) return n;
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(n.replace(/\s+/g, ""))) return "https://" + n.replace(/\s+/g, "");
    // Multi-word things that aren't obviously a site → search instead.
    if (n.split(/\s+/).length > 2) return null;
    return "https://www." + n.replace(/[^a-z0-9-]/g, "") + ".com";
  }

  const googleSearch = (q) => "https://www.google.com/search?q=" + encodeURIComponent(q);

  function parseCommand(raw) {
    let t = raw.trim().replace(/[.!?]+$/, "");
    t = t.replace(/^(hey |ok |okay )?jarvis[,\s]*/i, "")
      .replace(/^(please |could you |can you |would you |will you |i want you to |i'd like you to )+/i, "")
      .replace(/\s+please$/i, "")
      .trim();
    const lower = t.toLowerCase();
    let m;

    // YouTube searches
    if ((m = lower.match(/^(?:search|look up|find)\s+(?:on\s+)?youtube\s+for\s+(.+)$/)) ||
        (m = lower.match(/^(?:search|look up|find)\s+(?:for\s+)?(.+?)\s+on\s+youtube$/)) ||
        (m = lower.match(/^(?:play|watch)\s+(.+?)(?:\s+on\s+youtube)?$/))) {
      const q = m[1].trim();
      return { url: "https://www.youtube.com/results?search_query=" + encodeURIComponent(q), say: `Pulling up ${q} on YouTube, sir.` };
    }

    // Reddit / Wikipedia / Amazon / Maps searches
    const siteSearch = [
      [/^(?:search|look up|find)\s+(?:on\s+)?reddit\s+for\s+(.+)$|^(?:search|look up|find)\s+(?:for\s+)?(.+?)\s+on\s+reddit$/, (q) => "https://www.reddit.com/search/?q=" + encodeURIComponent(q), "Reddit"],
      [/^(?:search|look up|find)\s+(?:on\s+)?wikipedia\s+for\s+(.+)$|^(?:search|look up|find)\s+(?:for\s+)?(.+?)\s+on\s+wikipedia$/, (q) => "https://en.wikipedia.org/w/index.php?search=" + encodeURIComponent(q), "Wikipedia"],
      [/^(?:search|look up|find)\s+(?:on\s+)?amazon\s+for\s+(.+)$|^(?:search|look up|find)\s+(?:for\s+)?(.+?)\s+on\s+amazon$/, (q) => "https://www.amazon.com/s?k=" + encodeURIComponent(q), "Amazon"],
      [/^(?:show me |find |get )?directions to\s+(.+)$|^(?:find|show me|where is)\s+(.+?)\s+on\s+(?:the\s+)?maps?$/, (q) => "https://www.google.com/maps/search/" + encodeURIComponent(q), "Maps"],
    ];
    for (const [re, fn, label] of siteSearch) {
      if ((m = lower.match(re))) {
        const q = (m[1] || m[2]).trim();
        return { url: fn(q), say: `Searching ${label} for ${q}, sir.` };
      }
    }

    // Google searches
    if ((m = lower.match(/^(?:search\s+(?:google\s+|the web\s+|the internet\s+)?for|google|search|look up|search up)\s+(.+)$/))) {
      const q = m[1].trim();
      return { url: googleSearch(q), say: `Searching for ${q}, sir.` };
    }

    // Open a site
    if ((m = lower.match(/^(?:open(?: up)?|go to|launch|take me to|navigate to|bring up|pull up|show me|load|visit)\s+(.+)$/))) {
      const target = m[1].trim();
      const url = siteUrl(target);
      if (url) return { url, say: `Opening ${titleCase(target.replace(/^the\s+/, ""))}, sir.` };
      return { url: googleSearch(target), say: `I couldn't find a site by that name, sir, so I've searched for it.` };
    }

    return null;
  }

  function openUrl(url, label) {
    let win = null;
    try { win = window.open(url, "_blank"); } catch {}
    if (win) { try { win.opener = null; } catch {} }
    else showLinkCard(url, label); // pop-up blocked: offer a tap-to-open link
  }

  function showLinkCard(url, label) {
    linkCardA.href = url;
    linkCardA.textContent = "OPEN " + (label || "LINK").toUpperCase();
    linkCardText.textContent = "Safari held the new tab back — tap to open:";
    linkCard.classList.remove("hidden");
  }
  $("link-card-close").addEventListener("click", () => linkCard.classList.add("hidden"));
  linkCardA.addEventListener("click", () => setTimeout(() => linkCard.classList.add("hidden"), 300));

  // ---------- Gemini ----------
  async function askGemini(text) {
    const key = store.get("apiKey");
    if (!key) {
      openSettings();
      throw new Error("NO_KEY");
    }
    const model = (store.get("model") || DEFAULT_MODEL).trim().replace(/^models\//, "");
    history.push({ role: "user", parts: [{ text }] });
    if (history.length > MAX_TURNS) history = history.slice(-MAX_TURNS);
    while (history.length && history[0].role !== "user") history.shift();

    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT.replace("{{NOW}}", new Date().toString()) }] },
      contents: history,
      generationConfig: { temperature: 0.8 },
    };

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      history.pop();
      const msg = (data.error && data.error.message) || res.statusText || "Request failed";
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    const cand = data.candidates && data.candidates[0];
    const reply = ((cand && cand.content && cand.content.parts) || [])
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join("")
      .trim();
    if (!reply) {
      history.pop();
      const reason = (cand && cand.finishReason) || (data.promptFeedback && data.promptFeedback.blockReason) || "empty response";
      throw new Error("No reply (" + reason + ")");
    }
    history.push({ role: "model", parts: [{ text: reply }] });
    return reply;
  }

  // ---------- Main flow ----------
  async function handleInput(text) {
    log("YOU", text, "user");

    const cmd = parseCommand(text);
    if (cmd) {
      openUrl(cmd.url, new URL(cmd.url).hostname.replace(/^www\./, ""));
      history.push({ role: "user", parts: [{ text }] }, { role: "model", parts: [{ text: cmd.say }] });
      log("JARVIS", cmd.say, "jarvis");
      speak(cmd.say);
      return;
    }

    setState("thinking");
    try {
      const reply = await askGemini(text);
      log("JARVIS", reply, "jarvis");
      await speak(reply);
    } catch (err) {
      let say;
      if (err.message === "NO_KEY") {
        say = "I'll need a Gemini API key before I can think for myself, sir. Please paste one into the settings.";
      } else if (err.status === 400 && /api key/i.test(err.message)) {
        say = "That API key appears to be invalid, sir.";
      } else if (err.status === 429) {
        say = "We've hit the rate limit on the free tier, sir. Give it a moment.";
      } else if (err.status === 404) {
        say = "That model doesn't seem to exist, sir. You may want to change it in settings.";
      } else if (err instanceof TypeError) {
        say = "I can't reach the servers, sir. Check the connection.";
      } else {
        say = "Something went wrong on my end, sir.";
      }
      if (err.message !== "NO_KEY") log("SYSTEM", err.message, "system");
      log("JARVIS", say, "jarvis");
      setState("error");
      await speak(say);
      if (state !== "listening") setState("idle");
    }
  }

  talkBtn.addEventListener("click", () => {
    unlockSynth();
    if (state === "listening") return stopListening();
    if (state === "speaking") { stopSpeaking(); return setState("idle"); }
    if (state === "thinking") return;
    startListening();
  });

  $("text-form").addEventListener("submit", (e) => {
    e.preventDefault();
    unlockSynth();
    const input = $("text-input");
    const t = input.value.trim();
    if (!t || state === "thinking") return;
    input.value = "";
    input.blur();
    handleInput(t);
  });

  $("clear-btn").addEventListener("click", () => {
    history = [];
    logEl.innerHTML = "";
    log("SYSTEM", "Conversation memory cleared.", "system");
  });

  // ---------- Settings ----------
  function openSettings() {
    apiKeyIn.value = store.get("apiKey", "");
    modelIn.value = store.get("model", DEFAULT_MODEL);
    rateIn.value = store.get("rate", "1");
    rateVal.textContent = (+rateIn.value).toFixed(2) + "×";
    langIn.value = store.get("lang", "");
    langIn.placeholder = navigator.language || "en-US";
    loadVoices();
    if (typeof settingsDlg.showModal === "function") settingsDlg.showModal();
    else settingsDlg.setAttribute("open", "");
  }

  function saveSettings() {
    const k = apiKeyIn.value.trim();
    if (k) store.set("apiKey", k); else store.del("apiKey");
    store.set("model", modelIn.value.trim() || DEFAULT_MODEL);
    if (voiceSel.value) store.set("voice", voiceSel.value);
    store.set("rate", rateIn.value);
    if (langIn.value.trim()) store.set("lang", langIn.value.trim()); else store.del("lang");
    updateLinkStatus();
  }

  $("settings-btn").addEventListener("click", openSettings);
  rateIn.addEventListener("input", () => { rateVal.textContent = (+rateIn.value).toFixed(2) + "×"; });
  $("settings-form").addEventListener("submit", () => {
    saveSettings();
    log("SYSTEM", "Settings saved.", "system");
  });
  $("forget-key").addEventListener("click", () => {
    store.del("apiKey");
    apiKeyIn.value = "";
    updateLinkStatus();
    log("SYSTEM", "API key removed from this device.", "system");
  });
  $("test-voice").addEventListener("click", () => {
    unlockSynth();
    if (voiceSel.value) store.set("voice", voiceSel.value);
    store.set("rate", rateIn.value);
    speak("Good evening, sir. All systems are online.");
  });
  settingsDlg.addEventListener("click", (e) => { if (e.target === settingsDlg) settingsDlg.close(); });

  // ---------- Boot ----------
  setState("idle");
  updateLinkStatus();
  const h = new Date().getHours();
  const greet = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  log("JARVIS", `${greet}, sir. Tap the core whenever you need me.`, "jarvis");
  if (!store.get("apiKey")) {
    log("SYSTEM", "No Gemini API key found. Open settings (gear icon, top right) and paste your key.", "system");
  }
})();
