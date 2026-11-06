// THM Переводчик — фоновый service worker.
// Все запросы идут только к локальной модели: OpenAI-совместимый сервер на этом компьютере
// (llama.cpp llama-server, Ollama, LM Studio и т. п.). Тексты комнат никуда в интернет не уходят.
// Здесь же кэш переводов, словарь терминов комнаты, личный словарь, перевод картинок.

importScripts("languages.js");

const PROMPT_VERSION = 6;

// Вкладка закрылась или в ней ещё нет нашего скрипта — это не ошибка расширения, не засоряем список ошибок.
self.addEventListener("unhandledrejection", (e) => {
  if (/Receiving end does not exist|message port closed|No tab with id/i.test(e.reason?.message || "")) {
    console.debug("THM Переводчик:", e.reason.message);
    e.preventDefault();
  }
});
const DEFAULTS = {
  localUrl: "http://127.0.0.1:8080/v1", // llama-server по умолчанию; Ollama — :11434/v1, LM Studio — :1234/v1
  localModel: "", // пусто — первая модель из /models
  targetLang: "ru", // язык перевода, коды — в languages.js
  mode: "en", // en | ru | bi — последний выбранный режим, применяется ко всем комнатам
  prefetch: true, // готовить перевод всей комнаты заранее
  prefetchImages: true, // и картинки тоже (после текста)
  prefetchNext: 1, // сколько следующих комнат учебного пути готовить заранее (только текст)
  translateChat: true, // переводить сообщения и подсказки помощника Echo
  panel: null, // {right, bottom, collapsed}
};

async function getSettings() {
  const s = await chrome.storage.local.get("settings");
  return { ...DEFAULTS, ...(s.settings || {}) };
}

async function patchSettings(patch) {
  const s = await chrome.storage.local.get("settings");
  const next = { ...(s.settings || {}), ...patch };
  await chrome.storage.local.set({ settings: next });
  return { ...DEFAULTS, ...next };
}

// ---------- Промпты ----------
// Промпты на английском: так модель одинаково хорошо работает с любым языком перевода.
// Поле «tr» в JSON — перевод на выбранный язык (внутри расширения он хранится как «ru»).

function buildPrompts(L) {
  const lang = `${L.name} (${L.native})`;
  return {
    translate: `You are an experienced technical translator and cybersecurity teacher. You translate TryHackMe learning materials from English into ${lang} for a beginner who wants to truly understand what is being explained.

How to translate:
- Translate the meaning, not word by word. The result must read like a good ${L.name} textbook, not like machine translation. Restructure sentences when that makes them clearer, but never drop a fact and never add your own.
- Terminology. Use the terminology that ${L.name}-speaking security and networking professionals actually use. Keep abbreviations and established English loanwords (DNS, TCP, HTTP, SSH, payload, exploit, reverse shell, brute force, firewall, etc.) the way professionals really say them in ${L.name}. If a term has a good ${L.name} equivalent, use it and add the English original in parentheses the first time it appears in a fragment.
- If a room glossary is given, translate those terms exactly as in the glossary, so the translation stays consistent.
- Do not translate or change: commands, code, flags, paths, file names, URLs, IP addresses, domains, user names, tool and program names, text inside <code>, <pre>, <kbd>, and answer formats like "***". Keep button and menu names as they appear on screen; you may add a translation in parentheses.
- Do not give hints to the answers and do not add anything of your own.
- HTML: keep all tags, their nesting and attributes exactly. Change only the text between tags. Do not add or remove tags.

You receive a JSON array of HTML fragments. Return a JSON object:
- items — the translations in the same order, exactly as many elements as in the input array;
- terms — up to 8 important technical terms from these fragments that a beginner should remember and that are not in the glossary yet: en — the term as in the text, tr — the accepted ${L.name} version, note — what it means, one short sentence in plain ${L.name}. If there are no such terms, return an empty array.
All translated text must be in ${L.name}.`,

    explain: `You are a cybersecurity teacher and translator. The user is reading a TryHackMe lesson in English, has selected a fragment and wants to understand it in ${lang}. You get the selected fragment and the paragraph it appears in.

Return JSON {"translation": "...", "explanation": "..."}, both in ${L.name}:
- translation — an accurate, natural ${L.name} translation in exactly this context. For a single word or a short term give 1–3 options separated by commas, the best fit first.
- explanation — briefly (1–3 sentences) explain in plain words what it means here and why it matters. For a term, explain the term itself. If the fragment is long and simple, the explanation may be empty.
- If the fragment is a command, code, a path or program output: keep it as is in translation, and in explanation explain what it does and what its parts and flags mean.
Do not give ready answers to the task questions.`,

    explainDetail: `You are a cybersecurity teacher. The user is reading a TryHackMe lesson and asks for a detailed explanation of a fragment. You get the fragment and the paragraph it appears in.

Return JSON {"translation": "...", "explanation": "..."}, both in ${L.name}:
- translation — a natural ${L.name} translation of the fragment (keep commands and code as is).
- explanation — a detailed explanation in plain language for a beginner: what it is, how it works, why it is needed, a short practical example. For a command, break it down part by part. 1–3 paragraphs, no filler. Separate paragraphs with a blank line. Do not give ready answers to the task questions.`,

    image: `You are a cybersecurity teacher and translator. You get an image from a TryHackMe lesson (a screenshot, a diagram, terminal output, a program interface) and the lesson context.

Return JSON:
- texts — all English text in the image in reading order, grouped logically (a caption, a diagram item, an interface line): en — as in the image, tr — the ${L.name} translation. Do not translate commands, code, terminal output, URLs, paths, IP addresses, file, user and program names: for them tr is the same as en. Merge repeated small labels.
- summary — 1–2 sentences in ${L.name}: what the image shows and why it is in this lesson.
If there is no text in the image, texts is empty, but still give the summary.`,

    chat: `You are a cybersecurity mentor in a mini chat next to a TryHackMe lesson. The student is a beginner who reads the lesson in English and asks about what they did not understand.
Always answer in ${lang}, briefly and clearly: first the gist in 1–3 sentences, then an example if needed. Explain terms in plain words, with the English original in parentheses. Put commands and code in backticks and explain their flags. Base your answers on the lesson text from the context. For task questions: give a hint first, and a ready answer only if the student explicitly asks for it.`,
  };
}

async function prompts() {
  return buildPrompts(languageInfo((await getSettings()).targetLang));
}

const TERM_SCHEMA = {
  type: "object",
  properties: { en: { type: "string" }, tr: { type: "string" }, note: { type: "string" } },
  required: ["en", "tr", "note"],
  additionalProperties: false,
};

const ITEMS_SCHEMA = {
  type: "object",
  properties: {
    items: { type: "array", items: { type: "string" } },
    terms: { type: "array", items: TERM_SCHEMA },
  },
  required: ["items", "terms"],
  additionalProperties: false,
};

const EXPLAIN_SCHEMA = {
  type: "object",
  properties: { translation: { type: "string" }, explanation: { type: "string" } },
  required: ["translation", "explanation"],
  additionalProperties: false,
};

const IMAGE_SCHEMA = {
  type: "object",
  properties: {
    texts: {
      type: "array",
      items: {
        type: "object",
        properties: { en: { type: "string" }, tr: { type: "string" } },
        required: ["en", "tr"],
        additionalProperties: false,
      },
    },
    summary: { type: "string" },
  },
  required: ["texts", "summary"],
  additionalProperties: false,
};

// ---------- Провайдеры ----------

function fatal(message) {
  const e = new Error(message);
  e.fatal = true;
  return e;
}

function parseJsonLoose(text) {
  if (!text) throw new Error("Пустой ответ модели");
  if (typeof text === "object") return text;
  const t = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("Модель вернула не JSON");
  }
}

async function httpError(res) {
  let msg = `HTTP ${res.status}`;
  try {
    const j = await res.json();
    msg += ": " + (j.error?.message || j.message || JSON.stringify(j).slice(0, 300));
  } catch {
    /* тело не JSON */
  }
  const e = new Error(msg);
  e.status = res.status;
  return e;
}

let localModelCache = { url: "", id: "" };
async function resolveLocalModel(s) {
  if (s.localModel) return s.localModel;
  if (localModelCache.url === s.localUrl && localModelCache.id) return localModelCache.id;
  const res = await fetch(s.localUrl.replace(/\/$/, "") + "/models");
  if (!res.ok) throw await httpError(res);
  const id = (await res.json()).data?.[0]?.id;
  if (!id) throw new Error("Локальный сервер не сообщил ни одной модели");
  localModelCache = { url: s.localUrl, id };
  return id;
}

async function callLocal(s, { system, user, schema, maxTokens, image, messages }) {
  let model;
  try {
    model = await resolveLocalModel(s);
  } catch (e) {
    throw fatal(`Локальная модель недоступна (${s.localUrl}). ${e.message}`);
  }
  const content = image
    ? [{ type: "image_url", image_url: { url: `data:${image.mime};base64,${image.data}` } }, { type: "text", text: user }]
    : user;
  const base = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "system", content: system }, ...(messages || [{ role: "user", content }])],
  };
  // Без «размышлений» перевод в разы быстрее; JSON-схема заставляет модель вернуть ровно нужный формат.
  const extra = { chat_template_kwargs: { enable_thinking: false } };
  if (schema) extra.response_format = { type: "json_schema", json_schema: { name: "result", schema } };
  const url = s.localUrl.replace(/\/$/, "") + "/chat/completions";
  const post = (body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let res = await post({ ...base, ...extra });
  if (res.status === 400) res = await post(base); // сервер не знает response_format или chat_template_kwargs
  if (!res.ok) throw await httpError(res);
  const ch = (await res.json()).choices?.[0];
  if (ch?.finish_reason === "length") throw fatal("MAX_TOKENS");
  return schema ? parseJsonLoose(ch?.message?.content) : ch?.message?.content || "";
}

// Список моделей локального сервера — для выбора в настройках.
async function listLocalModels() {
  const s = await getSettings();
  let res;
  try {
    res = await fetch(s.localUrl.replace(/\/$/, "") + "/models");
  } catch (e) {
    throw fatal(`Сервер не отвечает (${s.localUrl}). ${e.message}`);
  }
  if (!res.ok) throw await httpError(res);
  return ((await res.json()).data || []).map((m) => m.id).filter(Boolean);
}

// Не больше трёх одновременных запросов, чтобы не перегружать локальный сервер.
let running = 0;
const waiters = [];
async function limited(fn) {
  if (running >= 3) await new Promise((r) => waiters.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiters.shift()?.();
  }
}

async function callLLM(req) {
  const s = await getSettings();
  const once = () => callLocal(s, req);
  return limited(async () => {
    try {
      return await once();
    } catch (e) {
      if (e.fatal || (e.status && e.status < 500 && e.status !== 429)) throw e;
      await new Promise((r) => setTimeout(r, e.status === 429 ? 6000 : 1500));
      return once(); // один повтор при сетевом сбое, 429 или 5xx
    }
  });
}

async function modelTag() {
  const s = await getSettings();
  return `l:${s.localModel || "auto"}:${s.targetLang}`;
}

// ---------- Кэш ----------

async function sha(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function cacheKey(kind, payload) {
  return "c:" + (await sha(`${PROMPT_VERSION}|${await modelTag()}|${kind}|${payload}`));
}

// ---------- Глоссарий комнаты ----------

const normTerm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9а-яё]+/gi, " ").trim();

let glossaryLock = Promise.resolve();
function mergeGlossary(room, terms) {
  if (!room || !terms?.length) return glossaryLock;
  glossaryLock = glossaryLock.then(async () => {
    const key = await glossaryKey(room);
    const cur = (await chrome.storage.local.get(key))[key] || [];
    const seen = new Set(cur.map((t) => normTerm(t.en)));
    for (const t of terms) {
      const n = normTerm(t?.en);
      const tr = t?.tr ?? t?.ru;
      if (!n || seen.has(n) || !tr || normTerm(tr) === n) continue; // «HTTP(S) → HTTP(S)» не нужен
      seen.add(n);
      cur.push({ en: String(t.en).trim(), ru: String(tr).trim(), note: String(t.note || "").trim() });
    }
    await chrome.storage.local.set({ [key]: cur });
  });
  return glossaryLock;
}

// Словарь комнаты свой для каждого языка перевода.
async function glossaryKey(room) {
  return `g:${(await getSettings()).targetLang}:${room}`;
}

async function getGlossary(room) {
  if (!room) return [];
  const key = await glossaryKey(room);
  return (await chrome.storage.local.get(key))[key] || [];
}

function lookupGlossary(glossary, text) {
  const n = normTerm(text);
  if (!n || n.split(" ").length > 5) return null;
  const variants = new Set([n, n.replace(/s$/, ""), n.replace(/es$/, ""), n.replace(/ies$/, "y")]);
  const base = (t) => normTerm(String(t.en).replace(/\s*\(.*\)\s*$/, ""));
  return glossary.find((t) => variants.has(normTerm(t.en)) || variants.has(base(t))) || null;
}

// ---------- Перевод блоков ----------
// Элемент: {key, html}. key — нормализованный текст блока: по нему кэш совпадает и для текста
// из API TryHackMe (подготовка заранее), и для блоков на странице.

function chunk(items, maxChars) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const it of items) {
    if (cur.length && size + it.html.length > maxChars) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(it);
    size += it.html.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function translateGroup(group, ctx) {
  const glossary = (await getGlossary(ctx.room)).slice(0, 80);
  const user =
    (ctx.title ? `Room: ${ctx.title}\n\n` : "") +
    (glossary.length ? `Room glossary:\n${glossary.map((t) => `${t.en} — ${t.ru}`).join("\n")}\n\n` : "") +
    "Fragments (JSON array):\n" +
    JSON.stringify(group.map((g) => g.html));
  const maxTokens = Math.min(32000, 3000 + Math.ceil(group.reduce((n, g) => n + g.html.length, 0) * 1.2));
  let res;
  try {
    res = await callLLM({ system: (await prompts()).translate, user, schema: ITEMS_SCHEMA, maxTokens });
  } catch (e) {
    if (e.message === "MAX_TOKENS" && group.length > 1) return splitAndTranslate(group, ctx);
    throw e;
  }
  if (!Array.isArray(res.items) || res.items.length !== group.length) {
    if (group.length === 1) throw new Error("Модель вернула неверное число фрагментов");
    return splitAndTranslate(group, ctx); // модель сбилась с количеством — делим пополам
  }
  await mergeGlossary(ctx.room, res.terms);
  return res.items.map((x) => String(x));
}

async function splitAndTranslate(group, ctx) {
  const mid = Math.ceil(group.length / 2);
  const [a, b] = await Promise.all([translateGroup(group.slice(0, mid), ctx), translateGroup(group.slice(mid), ctx)]);
  return [...a, ...b];
}

const inflight = new Map(); // cacheKey -> Promise<перевод>

async function translateItems(items, ctx) {
  items = items.map((it) => (typeof it === "string" ? { key: it, html: it } : it));
  const keys = await Promise.all(items.map((it) => cacheKey("t", it.key)));
  const cached = ctx.force ? {} : await chrome.storage.local.get(keys);
  const waits = new Array(items.length);
  const todo = [];
  const mine = new Map();
  items.forEach((it, i) => {
    const k = keys[i];
    if (cached[k] !== undefined) waits[i] = cached[k];
    else if (!ctx.force && inflight.has(k)) waits[i] = inflight.get(k);
    else if (mine.has(k)) waits[i] = mine.get(k);
    else {
      let resolve, reject;
      const p = new Promise((res, rej) => ((resolve = res), (reject = rej)));
      p.catch(() => {});
      inflight.set(k, p);
      mine.set(k, p);
      waits[i] = p;
      todo.push({ ...it, k, resolve, reject });
    }
  });
  const runGroup = async (group) => {
    try {
      const tr = await translateGroup(group, ctx);
      const toStore = {};
      group.forEach((g, j) => {
        toStore[g.k] = tr[j];
        g.resolve(tr[j]);
      });
      await chrome.storage.local.set(toStore);
    } catch (e) {
      group.forEach((g) => g.reject(e));
    } finally {
      group.forEach((g) => inflight.get(g.k) === mine.get(g.k) && inflight.delete(g.k));
    }
  };
  // Подготовка заранее идёт по одному куску за раз, чтобы не занимать все слоты;
  // запросы для того, что открыто на экране, идут параллельно.
  const groups = chunk(todo, 12000);
  if (ctx.prefetch) for (const g of groups) await runGroup(g);
  else await Promise.all(groups.map(runGroup));
  return Promise.all(waits);
}

// ---------- Объяснение выделенного ----------

async function explain({ text, context, title, room, detail, force }) {
  if (!detail && !force) {
    const hit = lookupGlossary(await getGlossary(room), text);
    if (hit) return { translation: hit.ru, explanation: hit.note, source: "glossary", term: hit.en };
  }
  const key = await cacheKey(detail ? "x2" : "x", text + "\n" + (context || ""));
  if (!force) {
    const c = (await chrome.storage.local.get(key))[key];
    if (c) return c;
  }
  const user = (title ? `Room: ${title}\n` : "") + `Paragraph (context):\n${context || "(none)"}\n\nFragment:\n${text}`;
  const p = await prompts();
  const res = await callLLM({
    system: detail ? p.explainDetail : p.explain,
    user,
    schema: EXPLAIN_SCHEMA,
    maxTokens: detail ? 6000 : 2500,
  });
  const out = { translation: String(res.translation || ""), explanation: String(res.explanation || "") };
  await chrome.storage.local.set({ [key]: out });
  return out;
}

// ---------- Картинки ----------

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Скачиваем картинку с CDN TryHackMe и уменьшаем до 1600 px по ширине: текст читается, токенов меньше.
// SVG отдаём странице — она растеризует его сама (в service worker SVG не декодируется).
async function loadImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось скачать картинку (HTTP ${res.status})`);
  const blob = await res.blob();
  const type = blob.type || "";
  if (/svg/.test(type) || /\.svg(\?|$)/i.test(url)) return { svg: await blob.text() };
  try {
    const bmp = await createImageBitmap(blob); // для GIF — первый кадр
    const scale = Math.min(1, 1600 / bmp.width);
    if (scale === 1 && blob.size < 1.5e6 && /png|jpeg|webp/.test(type)) return { mime: type, data: b64(await blob.arrayBuffer()) };
    const c = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const out = await c.convertToBlob({ type: "image/png" });
    return { mime: "image/png", data: b64(await out.arrayBuffer()) };
  } catch {
    if (/png|jpeg|webp/.test(type)) return { mime: type, data: b64(await blob.arrayBuffer()) };
    throw fatal("Этот формат картинки не поддерживается");
  }
}

const imageInflight = new Map();

async function translateImage({ url, data, mime, context, title, force }) {
  const key = await cacheKey("img", url);
  if (!force) {
    const c = (await chrome.storage.local.get(key))[key];
    if (c) return c;
    if (imageInflight.has(key)) return imageInflight.get(key);
  }
  const p = (async () => {
    const image = data ? { mime, data } : await loadImage(url);
    if (image.svg) return { needRaster: true, svg: image.svg };
    const user =
      (title ? `Room: ${title}\n` : "") +
      (context ? `Lesson text next to the image:\n${context.slice(0, 1200)}\n` : "") +
      "Analyze the image.";
    const res = await callLLM({ system: (await prompts()).image, user, schema: IMAGE_SCHEMA, maxTokens: 4000, image });
    const out = {
      texts: (res.texts || []).filter((t) => t && t.en).map((t) => ({ en: String(t.en), ru: String(t.tr || t.ru || t.en) })),
      summary: String(res.summary || ""),
    };
    await chrome.storage.local.set({ [key]: out });
    return out;
  })();
  imageInflight.set(key, p);
  try {
    return await p;
  } finally {
    imageInflight.delete(key);
  }
}

async function cachedImage(url) {
  const key = await cacheKey("img", url);
  return (await chrome.storage.local.get(key))[key] || null;
}

// ---------- Мои слова ----------

async function getWords() {
  return (await chrome.storage.local.get("words")).words || [];
}

async function saveWord(w) {
  const words = await getWords();
  const n = normTerm(w.en);
  const i = words.findIndex((x) => normTerm(x.en) === n);
  const item = { en: String(w.en).trim(), ru: String(w.ru || "").trim(), note: String(w.note || "").trim(), room: w.room || "", ts: Date.now() };
  if (i >= 0) words.splice(i, 1);
  words.unshift(item);
  await chrome.storage.local.set({ words });
  return words;
}

async function deleteWord(en) {
  const n = normTerm(en);
  const words = (await getWords()).filter((x) => normTerm(x.en) !== n);
  await chrome.storage.local.set({ words });
  return words;
}

// ---------- Обслуживание ----------

async function cacheStats() {
  const all = await chrome.storage.local.get(null);
  let entries = 0;
  let bytes = 0;
  let rooms = 0;
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith("c:")) {
      entries++;
      bytes += k.length + JSON.stringify(v).length;
    } else if (k.startsWith("g:")) rooms++;
  }
  return { entries, kb: Math.round(bytes / 1024), rooms, words: (all.words || []).length };
}

async function clearCache() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith("c:") || k.startsWith("g:"));
  await chrome.storage.local.remove(keys);
  return keys.length;
}

// Резервная копия: переводы, словари, мои слова, история чатов. Настройки (адрес сервера) не выгружаем.
async function exportData() {
  const all = await chrome.storage.local.get(null);
  delete all.settings;
  return { format: "thm-translate-backup", version: 1, created: new Date().toISOString(), data: all };
}

async function importData(backup) {
  if (backup?.format !== "thm-translate-backup" || typeof backup.data !== "object") throw fatal("Это не резервная копия THM Переводчика");
  const data = { ...backup.data };
  delete data.settings;
  const cur = await chrome.storage.local.get("words");
  if (Array.isArray(data.words) && Array.isArray(cur.words)) {
    const seen = new Set(cur.words.map((w) => normTerm(w.en)));
    data.words = [...cur.words, ...data.words.filter((w) => !seen.has(normTerm(w.en)))];
  }
  await chrome.storage.local.set(data);
  return Object.keys(data).length;
}

async function testConnection() {
  const t0 = Date.now();
  const res = await callLLM({
    system: (await prompts()).explain,
    user: "Paragraph (context):\nEach service listens on its own port.\n\nFragment:\nport",
    schema: EXPLAIN_SCHEMA,
    maxTokens: 800,
  });
  return { sample: res.translation, ms: Date.now() - t0 };
}

// ---------- Мини-чат ----------

async function chatAnswer(m) {
  // История передаётся каждый раз: локальный сервер не хранит разговор.
  const messages = [];
  for (const h of (m.history || []).slice(-10)) messages.push({ role: h.role === "user" ? "user" : "assistant", content: h.text });
  messages.push({ role: "user", content: (m.context ? `Context — what the student has open right now:\n${m.context.slice(0, 12000)}\n\n` : "") + m.text });
  return callLLM({ system: (await prompts()).chat, user: "", schema: null, maxTokens: 4000, messages });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "thmru-chat") return;
  port.onMessage.addListener(async (m) => {
    if (m.type !== "ask") return; // "reset": разговор живёт только во вкладке, сбрасывать на сервере нечего
    // Первый вопрос разговора с тем же контекстом (например, «Объясни эту задачу») — отвечаем из кэша мгновенно.
    const ckey = m.history?.length ? null : await cacheKey("chat", `${m.room}\n${m.context}\n${m.text.trim().toLowerCase()}`);
    if (ckey) {
      const hit = (await chrome.storage.local.get(ckey))[ckey];
      if (hit) {
        port.postMessage({ rid: m.rid, ok: true, done: true, text: hit, cached: true });
        return;
      }
    }
    try {
      const text = await chatAnswer(m);
      if (ckey && text) chrome.storage.local.set({ [ckey]: text });
      port.postMessage({ rid: m.rid, ok: true, done: true, text });
    } catch (e) {
      port.postMessage({ rid: m.rid, ok: false, error: e.message });
    }
  });
});

// ---------- Сообщения ----------

const handlers = {
  translate: (m) => translateItems(m.items, m).then((items) => ({ items })),
  explain: (m) => explain(m),
  translateImage: (m) => translateImage(m),
  cachedImage: (m) => cachedImage(m.url).then((result) => ({ result })),
  getGlossary: (m) => getGlossary(m.room).then((terms) => ({ terms })),
  getWords: () => getWords().then((words) => ({ words })),
  saveWord: (m) => saveWord(m.word).then((words) => ({ words })),
  deleteWord: (m) => deleteWord(m.en).then((words) => ({ words })),
  getSettings: () => getSettings().then((settings) => ({ settings })),
  setSettings: (m) => patchSettings(m.patch).then((settings) => ({ settings })),
  models: () => listLocalModels().then((models) => ({ models })),
  test: () => testConnection(),
  exportData: () => exportData().then((backup) => ({ backup })),
  importData: (m) => importData(m.backup).then((count) => ({ count })),
  cacheStats: () => cacheStats(),
  clearCache: () => clearCache().then((removed) => ({ removed })),
  openOptions: (m) => chrome.tabs.create({ url: chrome.runtime.getURL("options.html") + (m.hash || "") }).then(() => ({})),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  h(msg)
    .then((r) => sendResponse({ ok: true, ...r }))
    .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
  return true;
});

// ---------- Контекстное меню ----------

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: "thmru-explain",
    title: "Перевести и объяснить «%s»",
    contexts: ["selection"],
    documentUrlPatterns: ["https://tryhackme.com/*"],
  });
  chrome.contextMenus.create({
    id: "thmru-image",
    title: "Перевести текст на картинке",
    contexts: ["image"],
    documentUrlPatterns: ["https://tryhackme.com/*"],
  });
});

async function toTab(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    // Вкладка открыта до установки/обновления расширения — скрипта в ней нет, подгружаем.
    try {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ["languages.js", "content.js"] });
      await chrome.tabs.sendMessage(tabId, msg);
    } catch (e) {
      console.warn("THM Переводчик: вкладка недоступна", e);
    }
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === "thmru-explain") toTab(tab.id, { type: "explainSelection", text: info.selectionText || "" });
  if (info.menuItemId === "thmru-image") toTab(tab.id, { type: "translateImageAt", src: info.srcUrl || "" });
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
