// THM Переводчик — скрипт страницы tryhackme.com.
// Оригинальные блоки React не трогаем: прячем их атрибутом и ставим рядом свой блок с переводом.
(() => {
  if (window.__thmru) return;
  window.__thmru = true;

  const ATTR = "data-thmru"; // "pending" | "done" на оригинале
  const HIDE = "data-thmru-hide";
  const MUTED = "data-thmru-muted";
  const STATIC = { "Answer the questions below": "Ответьте на вопросы ниже" };
  const HINT_RE = /^This is the hint you.{1,3}re looking for:\s*/i;
  const DEAD_MSG = "Расширение обновлено — обновите страницу (F5)";

  let settings = {};
  let LANG = languageInfo("ru"); // язык перевода, обновляется из настроек при запуске
  let mode = "en"; // en | ru | bi («ru» — перевод на выбранный язык)

  // Язык и направление текста у блоков перевода (арабский, персидский, иврит, урду — справа налево).
  function markLang(el) {
    el.lang = LANG.code;
    if (LANG.rtl) el.dir = "rtl";
  }
  let busy = 0;
  let errorText = "";
  let failedAt = 0;
  let prep = null; // {room, phase, done, total, imgDone, imgTotal, imgFailed, error}
  let dead = false;

  const pairs = []; // {orig, tr, key, kind, prefix, showOrig}
  const pairOf = new WeakMap(); // tr|orig -> pair

  // ---------- Связь с фоном ----------

  function send(msg) {
    return new Promise((resolve) => {
      if (dead) return resolve({ ok: false, error: DEAD_MSG });
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          const le = chrome.runtime.lastError;
          if (le) {
            if (/context invalidated/i.test(le.message)) markDead();
            resolve({ ok: false, error: le.message });
          } else resolve(res || { ok: false, error: "Нет ответа от расширения" });
        });
      } catch {
        markDead();
        resolve({ ok: false, error: DEAD_MSG });
      }
    });
  }

  function markDead() {
    dead = true;
    errorText = DEAD_MSG;
    render();
  }

  // ---------- Страница ----------

  // THMRU_DEMO_ROOM задаёт только страница симулятора (demo/); на tryhackme.com его нет.
  const roomCode = () => (location.pathname.match(/^\/room\/([^/?#]+)/) || [])[1] || window.THMRU_DEMO_ROOM || null;
  const roomTitle = () =>
    (document.querySelector('h1[class*="StyledTitleText"]')?.textContent || document.title.replace(/^TryHackMe\s*\|\s*/, "")).trim();
  const normText = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  const SKIP_TAGS = new Set(["PRE", "SCRIPT", "STYLE", "IFRAME", "VIDEO", "AUDIO", "SVG", "CANVAS", "INPUT", "TEXTAREA", "FORM", "BUTTON"]);
  const BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "TABLE", "BLOCKQUOTE", "DL", "FIGCAPTION"]);

  function proseText(el) {
    // Текст без содержимого code/pre/kbd — по нему решаем, есть ли что переводить.
    const c = el.cloneNode(true);
    c.querySelectorAll("pre, code, kbd, script, style").forEach((x) => x.remove());
    return c.textContent || "";
  }
  const hasEnglish = (el) => /[A-Za-z]{3,}/.test(proseText(el));

  function collectBlocks(container, out = []) {
    for (const el of container.children) {
      if (el.classList.contains("thmru-tr") || el.classList.contains("thmru-img-card") || el.hasAttribute(ATTR)) continue;
      if (SKIP_TAGS.has(el.tagName) || el.id?.startsWith("ask-echo")) continue;
      if (!BLOCK_TAGS.has(el.tagName) && el.querySelector("p, ul, ol, h1, h2, h3, h4, h5, h6, table, pre, blockquote, div")) {
        collectBlocks(el, out);
        continue;
      }
      if (!el.textContent.trim() || !hasEnglish(el)) continue;
      out.push(el);
    }
    return out;
  }

  const KEEP_ATTR = new Set(["href", "src", "alt", "colspan", "rowspan"]);

  function sourceHtml(el) {
    const c = el.cloneNode(true);
    c.querySelectorAll("svg, script, style, [data-testid='ask-echo-button-container'], .thmru-tr, .thmru-img-card").forEach((x) => x.remove());
    // Кнопки глоссария TryHackMe внутри текста превращаем в обычный текст.
    c.querySelectorAll("button").forEach((b) => b.replaceWith(document.createTextNode(b.textContent)));
    c.querySelectorAll("*").forEach((n) => {
      for (const a of [...n.attributes]) if (!KEEP_ATTR.has(a.name)) n.removeAttribute(a.name);
    });
    return c.innerHTML.replace(/\s+/g, " ").trim();
  }

  const itemOf = (el) => ({ key: normText(el), html: sourceHtml(el) });

  const ALLOWED = new Set([
    "P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "B", "STRONG", "I", "EM", "U", "S",
    "CODE", "KBD", "MARK", "SUB", "SUP", "BR", "A", "SPAN", "DIV", "TABLE", "THEAD", "TBODY", "TR",
    "TD", "TH", "BLOCKQUOTE", "IMG", "PRE", "HR", "FIGURE", "FIGCAPTION", "SMALL", "DL", "DT", "DD",
  ]);

  // Переведённый HTML пришёл от модели — пропускаем только безопасные теги и атрибуты.
  function sanitizeInto(target, html, orig) {
    const imgSrc = new Set([...orig.querySelectorAll("img")].map((i) => i.getAttribute("src")));
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    const clean = (node, parent) => {
      for (const n of [...node.childNodes]) {
        if (n.nodeType === Node.TEXT_NODE) parent.appendChild(document.createTextNode(n.textContent));
        else if (n.nodeType === Node.ELEMENT_NODE) {
          if (!ALLOWED.has(n.tagName)) {
            clean(n, parent); // неизвестный тег — оставляем только текст
            continue;
          }
          if (n.tagName === "IMG" && !imgSrc.has(n.getAttribute("src"))) continue;
          const e = document.createElement(n.tagName);
          for (const a of n.attributes) {
            if (a.name === "href") {
              if (/^(https?:|#|\/)/i.test(a.value)) {
                e.setAttribute("href", a.value);
                e.setAttribute("target", "_blank");
                e.setAttribute("rel", "noopener noreferrer");
              }
            } else if (["src", "alt", "colspan", "rowspan"].includes(a.name)) e.setAttribute(a.name, a.value);
          }
          if (n.tagName === "IMG") e.style.maxWidth = "100%";
          parent.appendChild(e);
          clean(n, e);
        }
      }
    };
    target.textContent = "";
    clean(doc.body, target);
  }

  // ---------- Пары «оригинал — перевод» ----------

  function applyTranslation(orig, html, opt = {}) {
    if (!orig.isConnected || orig.getAttribute(ATTR) === "done") return;
    const tr = document.createElement(orig.tagName === "SPAN" ? "span" : orig.tagName);
    tr.className = orig.className;
    tr.classList.add("thmru-tr");
    markLang(tr);
    const p = { orig, tr, key: opt.key, kind: opt.kind || "block", prefix: opt.prefix || "", showOrig: false };
    fillTr(p, html);
    orig.before(tr);
    orig.setAttribute(ATTR, "done");
    pairs.push(p);
    pairOf.set(tr, p);
    pairOf.set(orig, p);
    updatePair(p);
  }

  function fillTr(p, html) {
    if (p.static) {
      p.tr.textContent = html;
      return;
    }
    sanitizeInto(p.tr, html, p.orig);
    if (p.prefix) {
      const b = document.createElement("b");
      b.textContent = p.prefix;
      p.tr.prepend(b);
    }
  }

  function updatePair(p) {
    const on = mode !== "en";
    p.tr.hidden = !on;
    const showOrig = on && p.kind !== "inline" && (mode === "bi" || p.showOrig);
    p.orig.toggleAttribute(HIDE, on && !showOrig);
    p.orig.toggleAttribute(MUTED, on && showOrig);
  }

  function cleanupOrphans() {
    for (let i = pairs.length - 1; i >= 0; i--) {
      if (!pairs[i].orig.isConnected) {
        pairs[i].tr.remove();
        pairs.splice(i, 1);
      }
    }
    for (const [url, c] of imgCards) {
      if (!c.img.isConnected || !c.card.isConnected) {
        c.card.remove();
        imgCards.delete(url);
      }
    }
  }

  function applyStatic(root) {
    if (LANG.code !== "ru") return; // готовые переводы надписей интерфейса есть только для русского
    root.querySelectorAll("div, span, h3, h4, p").forEach((el) => {
      if (el.children.length || el.hasAttribute(ATTR) || el.classList.contains("thmru-tr")) return;
      const ru = STATIC[el.textContent.trim()];
      if (!ru) return;
      const tr = document.createElement(el.tagName);
      tr.className = el.className;
      tr.classList.add("thmru-tr");
      tr.textContent = ru;
      el.before(tr);
      el.setAttribute(ATTR, "done");
      const p = { orig: el, tr, key: null, kind: "inline", static: true, showOrig: false };
      pairs.push(p);
      pairOf.set(tr, p);
      updatePair(p);
    });
  }

  // ---------- Что сейчас на экране ----------

  const chatSeen = new WeakMap(); // el -> {text, t}: сообщения Echo приходят по кусочкам — ждём, пока текст устоится
  let rescanTimer = 0;
  function scheduleRescan(ms) {
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(() => translateVisible(), ms);
  }

  function collectChat(out) {
    const now = Date.now();
    const els = document.querySelectorAll(
      '#chat-content-overlay [data-testid^="message-"] p, #chat-content-overlay [data-testid^="message-"] li, [data-testid="chat-button-description"] > span'
    );
    for (const el of els) {
      if (el.hasAttribute(ATTR) || el.classList.contains("thmru-tr") || el.closest(".thmru-tr")) continue;
      if (el.tagName === "LI" && el.querySelector("p")) continue;
      const text = normText(el);
      if (!/[A-Za-z]{3,}/.test(text)) continue;
      const s = chatSeen.get(el);
      if (!s || s.text !== text) {
        chatSeen.set(el, { text, t: now });
        scheduleRescan(1700);
        continue;
      }
      if (now - s.t < 1500) {
        scheduleRescan(1700);
        continue;
      }
      const m = text.match(HINT_RE);
      const inline = el.tagName === "SPAN";
      if (m) {
        const hint = text.slice(m[0].length);
        out.push({ el, item: { key: hint, html: escapeHtml(hint) }, kind: inline ? "inline" : "block", prefix: "Подсказка: " });
      } else out.push({ el, item: itemOf(el), kind: inline ? "inline" : "block" });
    }
  }

  function collectVisible() {
    const out = [];
    const push = (el, kind = "block") => {
      // Блок перевода копирует классы оригинала, поэтому селекторы находят и его. На латинице
      // (испанский, французский…) он похож на английский текст — без этой проверки перевод переводился бы снова.
      if (el.closest(".thmru-tr")) return;
      if (!el.hasAttribute(ATTR) && hasEnglish(el)) out.push({ el, item: itemOf(el), kind });
    };
    document.querySelectorAll('button[id^="header-"] [class*="StyledTaskTitle"]').forEach((t) => push(t, "inline"));
    const sub = document.querySelector('p[class*="StyledSubtitle"]:not(.thmru-tr)');
    if (sub) push(sub);
    document.querySelectorAll('[id^="content-"][role="region"]').forEach((r) => {
      applyStatic(r);
      const main = r.querySelector('[class*="StyledAccordionDetailsMain"]');
      if (main) collectBlocks(main).forEach((el) => out.push({ el, item: itemOf(el), kind: "block" }));
      r.querySelectorAll('[id^="question-text-"]').forEach((q) => push(q));
    });
    if (settings.translateChat !== false) collectChat(out);
    return out;
  }

  async function translateEntries(entries) {
    entries = entries.filter((e) => !e.el.hasAttribute(ATTR));
    if (!entries.length) return;
    entries.forEach((e) => e.el.setAttribute(ATTR, "pending"));
    busy++;
    render();
    const res = await send({ type: "translate", items: entries.map((e) => e.item), title: roomTitle(), room: roomCode() });
    busy--;
    entries.forEach((e) => e.el.removeAttribute(ATTR));
    if (res.ok) {
      entries.forEach((e, i) => applyTranslation(e.el, res.items[i], { key: e.item.key, kind: e.kind, prefix: e.prefix }));
      if (!dead) errorText = "";
    } else {
      errorText = res.error;
      failedAt = Date.now();
    }
    render();
  }

  function translateVisible() {
    if (mode === "en" || dead || !roomCode()) return;
    if (errorText && Date.now() - failedAt < 15000) return; // не долбим модель после ошибки
    const list = collectVisible();
    if (list.length) translateEntries(list);
    refreshImages();
  }

  function setMode(m, save = true) {
    mode = m;
    hideTools();
    pairs.forEach(updatePair);
    for (const c of imgCards.values()) c.card.hidden = mode === "en" && !c.manual;
    if (mode !== "en") translateVisible();
    if (save) {
      const patch = { mode };
      if (mode !== "en") patch.lastTr = mode;
      settings = { ...settings, ...patch };
      send({ type: "setSettings", patch });
    }
    render();
  }

  // ---------- Подготовка всей комнаты заранее ----------

  function apiTaskItems(task) {
    const items = [];
    const doc = new DOMParser().parseFromString(`<body>${task.description || ""}</body>`, "text/html");
    for (const el of collectBlocks(doc.body)) items.push(itemOf(el));
    for (const q of task.questions || []) {
      for (const html of [q.question, q.hint]) {
        if (!html) continue;
        const d = doc.createElement("div");
        d.innerHTML = html;
        if (hasEnglish(d)) items.push(itemOf(d));
      }
    }
    return items;
  }

  function apiImageUrls(tasks) {
    const urls = [];
    for (const t of tasks) {
      const doc = new DOMParser().parseFromString(`<body>${t.description || ""}</body>`, "text/html");
      doc.querySelectorAll("img[src]").forEach((i) => {
        const u = new URL(i.getAttribute("src"), location.href).href;
        if (/^https:\/\/([a-z0-9-]+\.)*tryhackme\.com\//.test(u) && !urls.includes(u)) urls.push(u);
      });
    }
    return urls;
  }

  // Обновить уже показанные переводы после «перевести заново».
  function refreshPairs(items, translations) {
    items.forEach((it, i) => pairs.filter((p) => p.key === it.key && !p.static).forEach((p) => fillTr(p, translations[i])));
  }

  async function prefetchRoom(force = false) {
    const code = roomCode();
    if (!code || dead) return;
    if (!force && (prep?.room === code || settings.prefetch === false)) return;
    const run = (prep = { room: code, phase: "text", done: 0, total: 0, imgDone: 0, imgTotal: 0, imgFailed: 0, error: "", forced: force });
    render();
    let tasks;
    try {
      const r = await fetch(`/api/v2/rooms/tasks?roomCode=${encodeURIComponent(code)}`, { credentials: "include" });
      tasks = (await r.json()).data || [];
    } catch {
      run.error = "не удалось получить задачи комнаты";
      render();
      return;
    }
    // Сначала раскрытые задачи, потом остальные по порядку.
    const open = [...document.querySelectorAll('[id^="content-"][role="region"]')].map((r) => +r.id.split("-")[1]);
    const ordered = [...tasks].sort((a, b) => (open.includes(b.taskNo) ? 1 : 0) - (open.includes(a.taskNo) ? 1 : 0) || a.taskNo - b.taskNo);
    run.total = tasks.length;
    render();
    const ctx = { type: "translate", title: roomTitle(), room: code, prefetch: true, force };
    const titles = tasks
      .filter((t) => /[A-Za-z]{3,}/.test(t.title || ""))
      .map((t) => ({ key: t.title.replace(/\s+/g, " ").trim(), html: escapeHtml(t.title) }));
    if (titles.length) {
      const r = await send({ ...ctx, items: titles });
      if (r.ok && force) refreshPairs(titles, r.items);
    }
    const failed = [];
    const doTask = async (t) => {
      const items = apiTaskItems(t);
      if (!items.length) return true;
      const res = await send({ ...ctx, items });
      if (!res.ok) {
        // Нет авторизации или моста — дальше пытаться бесполезно.
        if (/не авторизован|не отвечает|не запущена|обновите страницу/i.test(res.error || "")) throw new Error(res.error);
        run.lastError = res.error;
        return false;
      }
      if (force) refreshPairs(items, res.items);
      return true;
    };
    try {
      for (const t of ordered) {
        if (prep !== run) return; // ушли со страницы или запустили заново
        if (await doTask(t)) run.done++;
        else failed.push(t);
        render();
        if (mode !== "en") translateVisible();
      }
      // Неудачные задачи (временный сбой модели) — ещё одна попытка через несколько секунд.
      for (const t of failed) {
        if (prep !== run) return;
        await new Promise((r) => setTimeout(r, 4000));
        if (await doTask(t)) run.done++;
        else run.textFailed = (run.textFailed || 0) + 1;
        render();
        if (mode !== "en") translateVisible();
      }
    } catch (e) {
      run.error = e.message;
      render();
      return;
    }
    if (settings.prefetchImages === false) {
      run.phase = "done";
      render();
      prefetchNext(code, run);
      return;
    }
    const urls = apiImageUrls(ordered);
    run.phase = "img";
    run.imgTotal = urls.length;
    render();
    for (const url of urls) {
      if (prep !== run) return;
      const r = await imageResult(url, { force });
      if (!r.ok) {
        run.imgFailed++;
        if (/не авторизован|не отвечает/i.test(r.error || "")) {
          run.error = r.error;
          render();
          return;
        }
      } else showCardFor(url, r);
      run.imgDone++;
      render();
    }
    run.phase = "done";
    render();
    prefetchNext(code, run);
  }

  // Следующие комнаты учебного пути — тоже заранее, только текст.
  async function prefetchNext(code, run) {
    const n = Number(settings.prefetchNext ?? 1);
    if (!n || dead) return;
    let outline = [];
    try {
      const cur = (await (await fetch("/api/v2/paths/current", { credentials: "include" })).json()).data?.path?.code;
      if (!cur) return;
      const o = (await (await fetch(`/api/v2/paths/outline?pathCode=${encodeURIComponent(cur)}`, { credentials: "include" })).json()).data;
      outline = (o?.modules || []).flatMap((m) => (m.rooms || []).map((r) => ({ code: r.code, title: r.title })));
    } catch {
      return;
    }
    const i = outline.findIndex((r) => r.code === code);
    if (i < 0) return;
    for (const next of outline.slice(i + 1, i + 1 + n)) {
      if (prep !== run) return;
      let tasks = [];
      try {
        tasks = (await (await fetch(`/api/v2/rooms/tasks?roomCode=${encodeURIComponent(next.code)}`, { credentials: "include" })).json()).data || [];
      } catch {
        continue;
      }
      if (!tasks.length) continue;
      run.next = { title: next.title, done: 0, total: tasks.length };
      render();
      const ctx = { type: "translate", title: next.title, room: next.code, prefetch: true };
      const titles = tasks
        .filter((t) => /[A-Za-z]{3,}/.test(t.title || ""))
        .map((t) => ({ key: t.title.replace(/\s+/g, " ").trim(), html: escapeHtml(t.title) }));
      if (titles.length) await send({ ...ctx, items: titles });
      for (const t of tasks) {
        if (prep !== run) return;
        const items = apiTaskItems(t);
        if (items.length) {
          const r = await send({ ...ctx, items });
          if (!r.ok) {
            run.next = null;
            render();
            return;
          }
        }
        run.next.done++;
        render();
      }
      run.next = null;
      render();
    }
  }

  // ---------- Картинки ----------

  const imgCards = new Map(); // url -> {card, img, manual}
  const imgKnown = new Map(); // url -> результат (из кэша/перевода)

  const imgUrl = (img) => new URL(img.getAttribute("src") || img.src, location.href).href;

  function contentImages() {
    return [...document.querySelectorAll('[id^="content-"][role="region"] [class*="StyledAccordionDetailsMain"] img')].filter(
      (i) => !i.closest(".thmru-tr") && (i.naturalWidth || i.width) >= 100
    );
  }

  function imgContext(img) {
    const anchor = img.closest('[class*="StyledAccordionDetailsMain"] > *') || img;
    const parts = [];
    let p = anchor.previousElementSibling;
    while (p && (p.classList.contains("thmru-tr") || p.classList.contains("thmru-img-card"))) p = p.previousElementSibling;
    if (p) parts.push(normText(p));
    parts.push(normText(anchor));
    return parts.join("\n").slice(0, 1200);
  }

  function rasterSvg(svg) {
    return new Promise((resolve, reject) => {
      const u = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      const im = new Image();
      im.onload = () => {
        const w0 = im.naturalWidth || 1200;
        const h0 = im.naturalHeight || 800;
        const w = Math.min(1600, Math.max(800, w0));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = Math.round((w * h0) / w0);
        const g = c.getContext("2d");
        g.fillStyle = "#ffffff";
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(u);
        resolve(c.toDataURL("image/png").split(",")[1]);
      };
      im.onerror = () => {
        URL.revokeObjectURL(u);
        reject(new Error("SVG-схему не удалось отрисовать"));
      };
      im.src = u;
    });
  }

  async function imageResult(url, { force = false, context = "" } = {}) {
    if (!force && imgKnown.has(url)) return { ok: true, ...imgKnown.get(url) };
    let r = await send({ type: "translateImage", url, title: roomTitle(), context, force });
    if (r.ok && r.needRaster) {
      try {
        const data = await rasterSvg(r.svg);
        r = await send({ type: "translateImage", url, data, mime: "image/png", title: roomTitle(), context, force });
      } catch (e) {
        r = { ok: false, error: e.message };
      }
    }
    if (r.ok) imgKnown.set(url, { texts: r.texts || [], summary: r.summary || "" });
    return r;
  }

  function ensureCard(img, url) {
    let c = imgCards.get(url);
    if (c && c.card.isConnected) return c;
    const card = document.createElement("div");
    card.className = "thmru-img-card";
    let anchor = img.closest('[class*="StyledAccordionDetailsMain"] > *') || img;
    const pair = pairOf.get(anchor);
    if (pair) anchor = pair.orig; // карточка после пары «перевод + оригинал»
    let after = anchor;
    while (after.nextElementSibling?.classList.contains("thmru-img-card")) after = after.nextElementSibling;
    after.after(card);
    c = { card, img, manual: false };
    imgCards.set(url, c);
    return c;
  }

  function fillCard(c, url, r) {
    const { card } = c;
    card.textContent = "";
    card.classList.remove("thmru-collapsed");
    const head = document.createElement("div");
    head.className = "thmru-ic-head";
    head.append("Перевод картинки");
    card.append(head);
    if (!r) {
      const l = document.createElement("div");
      l.className = "thmru-ic-load";
      l.innerHTML = '<span class="thmru-spin"></span>';
      l.append("Читаю картинку… (10–15 с)");
      card.append(l);
      return;
    }
    if (r.error) {
      const e = document.createElement("div");
      e.className = "thmru-ic-err";
      e.textContent = "Не получилось: " + r.error;
      const retry = document.createElement("button");
      retry.textContent = "повторить";
      retry.onclick = () => translateImageFor(c.img, { manual: true, force: true });
      head.append(retry);
      card.append(e);
      return;
    }
    const toggle = document.createElement("button");
    toggle.textContent = "свернуть";
    toggle.onclick = () => {
      card.classList.toggle("thmru-collapsed");
      toggle.textContent = card.classList.contains("thmru-collapsed") ? "развернуть" : "свернуть";
    };
    const again = document.createElement("button");
    again.textContent = "↻";
    again.title = "Перевести картинку заново";
    again.onclick = () => translateImageFor(c.img, { manual: c.manual, force: true });
    if (r.texts.length) head.append(toggle);
    head.append(again);
    if (r.summary) {
      const s = document.createElement("div");
      s.className = "thmru-ic-sum";
      s.textContent = r.summary;
      card.append(s);
    }
    if (r.texts.length) {
      const rows = document.createElement("div");
      rows.className = "thmru-ic-rows";
      for (const t of r.texts) {
        if (t.ru.trim() === t.en.trim()) {
          const code = document.createElement("div");
          code.className = "thmru-ic-code";
          code.textContent = t.en;
          rows.append(code);
        } else {
          const en = document.createElement("div");
          en.className = "thmru-ic-en";
          en.textContent = t.en;
          const ru = document.createElement("div");
          ru.className = "thmru-ic-ru";
          ru.textContent = t.ru;
          markLang(ru);
          rows.append(en, ru);
        }
      }
      card.append(rows);
    } else if (!r.summary) {
      card.append("Текста на картинке нет.");
    }
  }

  async function translateImageFor(img, { manual = false, force = false } = {}) {
    const url = imgUrl(img);
    const c = ensureCard(img, url);
    c.manual = c.manual || manual;
    c.card.hidden = mode === "en" && !c.manual;
    fillCard(c, url, null);
    const r = await imageResult(url, { force, context: imgContext(img) });
    fillCard(c, url, r.ok ? { texts: r.texts || [], summary: r.summary || "" } : { error: r.error });
  }

  function showCardFor(url, r) {
    if (mode === "en") return;
    const img = contentImages().find((i) => imgUrl(i) === url);
    if (!img) return;
    const c = ensureCard(img, url);
    c.card.hidden = false;
    fillCard(c, url, { texts: r.texts || [], summary: r.summary || "" });
  }

  const imgChecked = new Set();
  async function refreshImages() {
    if (mode === "en") return;
    for (const img of contentImages()) {
      const url = imgUrl(img);
      const c = imgCards.get(url);
      if (c && c.card.isConnected) continue;
      if (imgKnown.has(url)) {
        showCardFor(url, imgKnown.get(url));
        continue;
      }
      if (imgChecked.has(url)) continue;
      imgChecked.add(url);
      const r = await send({ type: "cachedImage", url });
      if (r.ok && r.result) {
        imgKnown.set(url, r.result);
        showCardFor(url, r.result);
      } else imgChecked.delete(url); // ещё не готово — проверим при следующем обновлении
    }
  }

  // ---------- Интерфейс (Shadow DOM, чтобы стили сайта не мешали) ----------

  const ICONS = {
    book: '<svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/></svg>',
    dots: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
    grip: '<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>',
    speak: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    redo: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
    help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><circle cx="12" cy="17.3" r=".6"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/><path d="M8.5 10.5h7M8.5 13.5h4.5"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  };

  const host = document.createElement("div");
  host.id = "thmru-host";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
  <style>
    :host { all: initial; }
    * { box-sizing: border-box; }
    .ui { --bg:#161d2e; --card:#1c2538; --card2:#222d44; --line:#2e3c58; --text:#e6edf3; --muted:#93a1b8;
      --accent:#a3ea2a; --ink:#10190a; --danger:#ff7a7a; font: 13px/1.4 var(--font, system-ui, sans-serif); color: var(--text); }
    svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
    svg circle[r="1.6"], svg circle[r="1.4"], svg circle[r=".6"] { fill: currentColor; stroke: none; }
    button { font: inherit; color: inherit; cursor: pointer; }
    .ibtn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 8px;
      background: transparent; border: 0; color: var(--muted); }
    .ibtn:hover { background: var(--card2); color: var(--text); }
    .ibtn.on { color: var(--accent); }

    /* Панель */
    .panel { position: fixed; z-index: 2147483000; display: flex; align-items: center; gap: 4px; padding: 5px;
      background: var(--card); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.45); user-select: none; }
    .panel[hidden] { display: none; }
    .grip { cursor: grab; width: 18px; color: #5d6b85; }
    .grip:active { cursor: grabbing; }
    .seg { display: flex; background: var(--bg); border-radius: 9px; padding: 3px; gap: 2px; }
    .seg button { border: 0; background: transparent; color: var(--muted); padding: 5px 10px; border-radius: 7px; font-weight: 600; letter-spacing: .02em; }
    .seg button:hover { color: var(--text); }
    .seg button.on { background: var(--accent); color: var(--ink); }
    .status { display: flex; align-items: center; gap: 7px; padding: 0 8px; max-width: 280px; color: var(--muted); white-space: nowrap; }
    .status .txt { overflow: hidden; text-overflow: ellipsis; }
    .status.err { color: var(--danger); cursor: pointer; white-space: normal; }
    .status.ok { color: var(--accent); }
    .ring { width: 18px; height: 18px; flex: none; transform: rotate(-90deg); }
    .ring circle { fill: none; stroke-width: 3; }
    .ring .bg { stroke: var(--line); }
    .ring .fg { stroke: var(--accent); transition: stroke-dashoffset .3s; }
    .spin { width: 14px; height: 14px; border: 2px solid var(--accent); border-right-color: transparent; border-radius: 50%; animation: rot .7s linear infinite; flex: none; }
    @keyframes rot { to { transform: rotate(360deg); } }
    .mini { width: 44px; height: 44px; border-radius: 50%; position: fixed; z-index: 2147483000; border: 1px solid var(--line);
      background: var(--card); color: var(--accent); font-weight: 700; box-shadow: 0 8px 24px rgba(0,0,0,.45); display: grid; place-items: center; }
    .mini[hidden] { display: none; }
    .mini .ring { position: absolute; inset: 2px; width: 38px; height: 38px; }

    /* Меню */
    .menu { position: fixed; z-index: 2147483002; min-width: 250px; background: var(--card); border: 1px solid var(--line);
      border-radius: 10px; padding: 5px; box-shadow: 0 12px 30px rgba(0,0,0,.5); }
    .menu[hidden] { display: none; }
    .menu button { display: flex; width: 100%; align-items: center; gap: 10px; padding: 8px 10px; border: 0; background: transparent;
      border-radius: 7px; text-align: left; color: var(--text); }
    .menu button:hover { background: var(--card2); }
    .menu button svg { color: var(--muted); }
    .menu .kbd { margin-left: auto; color: var(--muted); font-size: 11px; }
    .menu hr { border: 0; border-top: 1px solid var(--line); margin: 4px 2px; }
    .menu .warn { color: var(--danger); }

    /* Всплывающее окно перевода */
    .pop { position: fixed; z-index: 2147483003; width: min(440px, calc(100vw - 16px)); background: var(--card); border: 1px solid var(--line);
      border-radius: 12px; box-shadow: 0 16px 40px rgba(0,0,0,.55); overflow: hidden; }
    .pop .hd { display: flex; align-items: flex-start; gap: 6px; padding: 10px 10px 8px 14px; background: var(--bg); border-bottom: 1px solid var(--line); }
    .pop .src { flex: 1; color: var(--muted); font-size: 12.5px; max-height: 3.9em; overflow: hidden; word-break: break-word; padding-top: 6px; }
    .pop .bd { padding: 12px 14px; max-height: min(60vh, 520px); overflow: auto; }
    .pop .tr { font-size: 15.5px; font-weight: 600; white-space: pre-wrap; word-break: break-word; }
    .pop .ex { margin-top: 8px; white-space: pre-wrap; color: #cdd6e3; font-size: 13.5px; line-height: 1.5; }
    [dir="rtl"] pre, [dir="rtl"] code { direction: ltr; unicode-bidi: isolate; } /* команды всегда слева направо */
    .pop .badge { display: inline-block; margin-top: 8px; font-size: 11px; color: var(--accent); border: 1px solid rgba(163,234,42,.35); border-radius: 20px; padding: 1px 8px; }
    .pop .ft { display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid var(--line); }
    .pop .ft .btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); background: var(--bg); border-radius: 8px; padding: 5px 10px; font-size: 12.5px; }
    .pop .ft .btn:hover { border-color: #415273; }
    .pop .ft .btn.primary { background: var(--accent); color: var(--ink); border-color: var(--accent); font-weight: 600; }
    .pop .ft .sp { flex: 1; }
    .pop .err { color: var(--danger); }
    .skel { height: 12px; border-radius: 6px; background: linear-gradient(90deg, #26314a 0%, #2f3c59 50%, #26314a 100%); background-size: 200% 100%; animation: sh 1.2s infinite; margin: 8px 0; }
    @keyframes sh { to { background-position: -200% 0; } }
    .wait { color: var(--muted); font-size: 12px; margin-top: 6px; }

    /* Кнопка у выделения и инструменты блока/картинки */
    .selbtn { position: fixed; z-index: 2147483003; border: 0; border-radius: 7px; background: var(--accent); color: var(--ink);
      font-weight: 700; padding: 4px 8px; box-shadow: 0 4px 14px rgba(0,0,0,.45); font-size: 12px; }
    .tools { position: fixed; z-index: 2147483001; display: flex; gap: 2px; padding: 3px; background: var(--card); border: 1px solid var(--line);
      border-radius: 9px; box-shadow: 0 6px 18px rgba(0,0,0,.45); }
    .tools[hidden] { display: none; }
    .tools .ibtn { width: auto; height: 26px; padding: 0 8px; gap: 5px; font-size: 12px; }
    .tools .ibtn svg { width: 14px; height: 14px; }

    /* Словарь */
    .drawer { position: fixed; z-index: 2147483002; top: 72px; right: 14px; bottom: 14px; width: min(400px, calc(100vw - 28px));
      background: var(--card); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 16px 50px rgba(0,0,0,.55); display: flex; flex-direction: column; }
    .drawer[hidden] { display: none; }
    .drawer .top { display: flex; align-items: center; gap: 6px; padding: 10px 10px 0 14px; }
    .drawer .title { font-weight: 700; font-size: 15px; flex: 1; }
    .tabs { display: flex; gap: 4px; padding: 10px 14px 0; }
    .tabs button { border: 0; background: transparent; color: var(--muted); padding: 6px 10px; border-radius: 8px; font-weight: 600; }
    .tabs button.on { background: var(--card2); color: var(--text); }
    .search { margin: 10px 14px; padding: 8px 10px; border-radius: 9px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font: inherit; outline: none; }
    .search:focus { border-color: #4a5d82; }
    .list { flex: 1; overflow: auto; padding: 0 8px 8px; }
    .item { padding: 10px 8px; border-bottom: 1px solid rgba(46,60,88,.6); }
    .item .row { display: flex; align-items: center; gap: 4px; }
    .item .en { font-weight: 700; flex: 1; word-break: break-word; }
    .item .ru { color: var(--accent); margin-top: 2px; }
    .item .note { color: var(--muted); margin-top: 3px; font-size: 12.5px; }
    .item .ibtn { width: 26px; height: 26px; }
    .item .ibtn svg { width: 14px; height: 14px; }
    .empty { color: var(--muted); padding: 20px 10px; text-align: center; line-height: 1.6; }
    .drawer .foot { padding: 10px 14px; border-top: 1px solid var(--line); display: flex; gap: 8px; }
    .drawer .foot button { border: 1px solid var(--line); background: var(--bg); border-radius: 8px; padding: 6px 10px; }

    /* Справка */
    .modal { position: fixed; inset: 0; z-index: 2147483004; background: rgba(5,8,15,.55); display: grid; place-items: center; }
    .modal[hidden] { display: none; }
    .modal .box { width: min(520px, calc(100vw - 32px)); background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 18px 20px; }
    .modal h2 { margin: 0 0 12px; font-size: 17px; }
    .modal table { width: 100%; border-collapse: collapse; }
    .modal td { padding: 6px 4px; border-bottom: 1px solid rgba(46,60,88,.6); vertical-align: top; }
    .modal td:first-child { white-space: nowrap; color: var(--accent); font-weight: 600; width: 1%; padding-right: 16px; }
    .modal .x { float: right; }

    /* Мини-чат */
    .chat { position: fixed; z-index: 2147483002; right: 14px; bottom: 74px; width: min(420px, calc(100vw - 28px)); height: min(600px, calc(100vh - 100px));
      background: var(--card); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 16px 50px rgba(0,0,0,.55); display: flex; flex-direction: column; overflow: hidden; }
    .chat[hidden] { display: none; }
    .chat .top { display: flex; align-items: center; gap: 6px; padding: 10px 8px 10px 14px; border-bottom: 1px solid var(--line); background: var(--bg); }
    .chat .title { font-weight: 700; font-size: 14.5px; }
    .chat .ctx { color: var(--muted); font-size: 11.5px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chat .msgs { flex: 1; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    .msg { max-width: 92%; padding: 9px 12px; border-radius: 12px; line-height: 1.5; font-size: 13.5px; word-break: break-word; }
    .msg.user { align-self: flex-end; background: #2a3a5c; border-bottom-right-radius: 4px; white-space: pre-wrap; }
    .msg.bot { align-self: flex-start; background: var(--bg); border: 1px solid var(--line); border-bottom-left-radius: 4px; }
    .msg.bot p { margin: 0 0 6px; } .msg.bot p:last-child { margin: 0; }
    .msg.bot code { font-family: ui-monospace, "JetBrains Mono", Menlo, monospace; font-size: 12.5px; background: #0f1522; border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }
    .msg.bot pre { margin: 6px 0; padding: 8px 10px; background: #0f1522; border: 1px solid var(--line); border-radius: 8px; overflow: auto; white-space: pre; }
    .msg.bot pre code { background: none; border: 0; padding: 0; }
    .msg.bot ul { margin: 4px 0 6px; padding-left: 18px; }
    .msg.err { align-self: stretch; color: var(--danger); background: rgba(255,122,122,.08); border: 1px solid rgba(255,122,122,.3); }
    .msg .meta { color: var(--muted); font-size: 11px; margin-top: 4px; }
    .typing { display: inline-flex; gap: 4px; padding: 4px 0; }
    .typing i { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: bl 1s infinite; }
    .typing i:nth-child(2) { animation-delay: .15s; } .typing i:nth-child(3) { animation-delay: .3s; }
    @keyframes bl { 0%,80%,100% { opacity: .25; } 40% { opacity: 1; } }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 12px 10px; }
    .chips[hidden], .drawer .foot[hidden] { display: none; }
    .chips button { border: 1px solid var(--line); background: var(--bg); border-radius: 20px; padding: 5px 10px; font-size: 12px; color: var(--text); }
    .chips button:hover { border-color: var(--accent); }
    .intro { color: var(--muted); font-size: 12.5px; line-height: 1.55; padding: 6px 4px; }
    .compose { display: flex; gap: 8px; align-items: flex-end; padding: 10px 12px; border-top: 1px solid var(--line); background: var(--bg); }
    .compose textarea { flex: 1; resize: none; max-height: 140px; min-height: 38px; padding: 9px 10px; border-radius: 10px; border: 1px solid var(--line);
      background: var(--card); color: var(--text); font: inherit; font-size: 13.5px; outline: none; }
    .compose textarea:focus { border-color: #4a5d82; }
    .compose .go { width: 38px; height: 38px; border-radius: 10px; border: 0; background: var(--accent); color: var(--ink); display: grid; place-items: center; }
    .compose .go:disabled { opacity: .4; cursor: default; }

    .toast { position: fixed; z-index: 2147483005; left: 50%; bottom: 28px; transform: translateX(-50%); background: var(--card2);
      border: 1px solid var(--line); border-radius: 10px; padding: 8px 14px; box-shadow: 0 8px 24px rgba(0,0,0,.45); }
  </style>
  <div class="ui">
    <div class="panel" hidden>
      <div class="ibtn grip" title="Перетащить">${ICONS.grip}</div>
      <div class="seg">
        <button data-m="en" title="Оригинал (Alt+R)">EN</button>
        <button data-m="ru" title="Перевод (Alt+R)">RU</button>
        <button data-m="bi" title="Перевод и оригинал под ним (Alt+B)">RU+EN</button>
      </div>
      <div class="status"><span class="ico"></span><span class="txt"></span></div>
      <button class="ibtn chatbtn" title="Спросить наставника (Alt+C)">${ICONS.chat}</button>
      <button class="ibtn dict" title="Словарь комнаты и мои слова (Alt+D)">${ICONS.book}</button>
      <button class="ibtn more" title="Ещё">${ICONS.dots}</button>
    </div>
    <button class="mini" hidden title="THM Переводчик — развернуть"></button>
    <div class="menu" hidden>
      <button data-a="chat">${ICONS.chat}Спросить наставника<span class="kbd">Alt+C</span></button>
      <button data-a="dict">${ICONS.book}Словарь и мои слова<span class="kbd">Alt+D</span></button>
      <button data-a="images">${ICONS.image}Перевести картинки в открытых задачах</button>
      <button data-a="redo">${ICONS.redo}<span class="lbl">Перевести комнату заново</span></button>
      <hr>
      <button data-a="help">${ICONS.help}Горячие клавиши и подсказки</button>
      <button data-a="settings">${ICONS.gear}Настройки</button>
      <button data-a="collapse">${ICONS.minus}Свернуть панель</button>
    </div>
    <div class="tools" hidden></div>
    <div class="drawer" hidden>
      <div class="top"><div class="title">Словарь</div><button class="ibtn dclose" title="Закрыть (Esc)">${ICONS.close}</button></div>
      <div class="tabs"><button data-t="room" class="on">Термины комнаты</button><button data-t="mine">Мои слова</button></div>
      <input class="search" placeholder="Поиск по словарю">
      <div class="list"></div>
      <div class="foot"></div>
    </div>
    <div class="chat" hidden>
      <div class="top"><div class="title">Наставник</div><div class="ctx"></div>
        <button class="ibtn cnew" title="Новый разговор">${ICONS.plus}</button>
        <button class="ibtn cclose" title="Закрыть (Esc)">${ICONS.close}</button></div>
      <div class="msgs"></div>
      <div class="chips"></div>
      <div class="compose"><textarea rows="1" placeholder="Спросите, что непонятно…  (Enter — отправить)"></textarea>
        <button class="go" title="Отправить">${ICONS.send}</button></div>
    </div>
    <div class="modal" hidden><div class="box">
      <button class="ibtn x" title="Закрыть">${ICONS.close}</button>
      <h2>Горячие клавиши</h2>
      <table>
        <tr><td>Alt+R</td><td>Перевод ↔ оригинал</td></tr>
        <tr><td>Alt+B</td><td>Перевод и оригинал под ним</td></tr>
        <tr><td>Удерживать Alt</td><td>Подсмотреть оригинал, пока держите</td></tr>
        <tr><td>Alt+T</td><td>Перевести и объяснить выделенное</td></tr>
        <tr><td>Alt+D</td><td>Словарь комнаты и мои слова</td></tr>
        <tr><td>Alt+C</td><td>Мини-чат с наставником: спросите, что непонятно</td></tr>
        <tr><td>Esc</td><td>Закрыть окна</td></tr>
      </table>
      <h2 style="margin-top:16px">Подсказки</h2>
      <table>
        <tr><td>Выделение</td><td>Выделите слово, фразу или команду — появится кнопка RU. Термины из словаря комнаты объясняются мгновенно.</td></tr>
        <tr><td>Абзац</td><td>Наведите на переведённый абзац: оригинал, перевести заново, подробное объяснение.</td></tr>
        <tr><td>Картинка</td><td>Наведите на картинку или нажмите на ней правой кнопкой — перевод текста со скриншота.</td></tr>
        <tr><td>Заранее</td><td>Комната переводится в фоне сразу при открытии, вместе с подсказками и картинками.</td></tr>
      </table>
    </div></div>
  </div>`;

  const $ = (s) => root.querySelector(s);
  const panel = $(".panel");
  const miniBtn = $(".mini");
  const menu = $(".menu");
  const statusEl = $(".status");
  const tools = $(".tools");
  const drawer = $(".drawer");
  const modal = $(".modal");
  const chatEl = $(".chat");

  function toast(text) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = text;
    $(".ui").append(t);
    setTimeout(() => t.remove(), 1800);
  }

  function ring(frac) {
    const r = 7;
    const len = 2 * Math.PI * r;
    return `<svg class="ring" viewBox="0 0 18 18"><circle class="bg" cx="9" cy="9" r="${r}"/><circle class="fg" cx="9" cy="9" r="${r}" stroke-dasharray="${len}" stroke-dashoffset="${len * (1 - frac)}"/></svg>`;
  }

  // ---------- Панель ----------

  function placePanel() {
    const p = settings.panel || {};
    const right = Math.min(Math.max(8, p.right ?? 84), innerWidth - 120);
    const bottom = Math.min(Math.max(8, p.bottom ?? 18), innerHeight - 60);
    for (const el of [panel, miniBtn]) {
      el.style.right = right + "px";
      el.style.bottom = bottom + "px";
    }
  }

  function render() {
    const onRoom = !!roomCode();
    const collapsed = !!settings.panel?.collapsed;
    panel.hidden = !onRoom || collapsed;
    miniBtn.hidden = !onRoom || !collapsed;
    root.querySelectorAll(".seg button").forEach((b) => b.classList.toggle("on", b.dataset.m === mode));

    const pr = prep && prep.room === roomCode() ? prep : null;
    const ico = statusEl.querySelector(".ico");
    const txt = statusEl.querySelector(".txt");
    statusEl.className = "status";
    statusEl.title = "";
    let frac = 1;
    if (dead) {
      statusEl.classList.add("err");
      ico.innerHTML = "";
      txt.textContent = DEAD_MSG;
    } else if (errorText || pr?.error) {
      statusEl.classList.add("err");
      ico.innerHTML = "";
      txt.textContent = (errorText || pr.error).slice(0, 140) + " — повторить";
      statusEl.title = errorText || pr.error;
    } else if (pr && pr.phase === "text" && pr.total) {
      frac = pr.done / pr.total;
      ico.innerHTML = ring(frac);
      txt.textContent = `Готовлю перевод: ${pr.done}/${pr.total} задач`;
    } else if (pr && pr.phase === "img" && pr.imgTotal) {
      frac = pr.imgDone / pr.imgTotal;
      ico.innerHTML = ring(frac);
      txt.textContent = `Текст готов ✓  Картинки: ${pr.imgDone}/${pr.imgTotal}`;
      statusEl.title = "Текст комнаты уже переведён, в фоне читаются картинки";
    } else if (busy) {
      ico.innerHTML = '<span class="spin"></span>';
      txt.textContent = "Перевожу…";
    } else if (pr && pr.textFailed && pr.phase === "done") {
      statusEl.classList.add("err");
      ico.innerHTML = "";
      txt.textContent = `Не переведено задач: ${pr.textFailed} — повторить`;
      statusEl.title = pr.lastError || "";
    } else if (pr && pr.phase === "done" && pr.next) {
      frac = pr.next.total ? pr.next.done / pr.next.total : 0;
      ico.innerHTML = ring(frac);
      txt.textContent = `Комната готова ✓  Следующая: ${pr.next.done}/${pr.next.total}`;
      statusEl.title = `Заранее готовлю следующую комнату пути: ${pr.next.title}`;
    } else if (pr && (pr.phase === "done" || (pr.phase === "img" && !pr.imgTotal))) {
      statusEl.classList.add("ok");
      ico.innerHTML = "";
      txt.textContent = mode === "en" ? "Перевод готов — Alt+R" : "Комната переведена ✓";
      if (pr.imgFailed) statusEl.title = `Не удалось прочитать картинок: ${pr.imgFailed}`;
    } else {
      ico.innerHTML = "";
      txt.textContent = "";
    }
    miniBtn.innerHTML = (frac < 1 ? ring(frac) : "") + `<span>${mode === "en" ? "EN" : LANG.short}</span>`;
  }

  root.querySelectorAll(".seg button").forEach((b) => (b.onclick = () => setMode(b.dataset.m)));
  statusEl.onclick = () => {
    if (dead) return;
    if (errorText || prep?.error || prep?.textFailed) {
      errorText = "";
      failedAt = 0;
      const p = prep;
      prep = null;
      render();
      prefetchRoom(!!p?.forced);
      translateVisible();
    }
  };

  function savePanel(patch) {
    settings.panel = { ...(settings.panel || {}), ...patch };
    send({ type: "setSettings", patch: { panel: settings.panel } });
    placePanel();
    render();
  }

  // Перетаскивание панели за «ручку».
  $(".grip").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    const dx = e.clientX - r.right;
    const dy = e.clientY - r.bottom;
    const move = (ev) => {
      panel.style.right = Math.max(8, innerWidth - (ev.clientX - dx)) + "px";
      panel.style.bottom = Math.max(8, innerHeight - (ev.clientY - dy)) + "px";
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      savePanel({ right: parseInt(panel.style.right), bottom: parseInt(panel.style.bottom) });
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  });

  miniBtn.onclick = () => savePanel({ collapsed: false });

  // ---------- Меню ----------

  let redoArmed = false;
  $(".more").onclick = (e) => {
    e.stopPropagation();
    if (!menu.hidden) return closeMenu();
    redoArmed = false;
    menu.querySelector('[data-a="redo"] .lbl').textContent = "Перевести комнату заново";
    menu.querySelector('[data-a="redo"]').classList.remove("warn");
    menu.hidden = false;
    const r = $(".more").getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.right - m.width, innerWidth - m.width - 8)) + "px";
    menu.style.top = (r.top - m.height - 8 > 8 ? r.top - m.height - 8 : r.bottom + 8) + "px";
  };
  const closeMenu = () => (menu.hidden = true);

  menu.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-a]");
    if (!b) return;
    const a = b.dataset.a;
    if (a === "redo") {
      if (!redoArmed) {
        redoArmed = true;
        b.classList.add("warn");
        b.querySelector(".lbl").textContent = "Нажмите ещё раз — перевод заменится";
        return;
      }
      closeMenu();
      prep = null;
      prefetchRoom(true).then(() => !prep?.error && toast("Комната переведена заново"));
      return;
    }
    closeMenu();
    if (a === "dict") openDrawer();
    if (a === "chat") openChat();
    if (a === "help") modal.hidden = false;
    if (a === "settings") send({ type: "openOptions" });
    if (a === "collapse") savePanel({ collapsed: true });
    if (a === "images") {
      const imgs = contentImages();
      if (!imgs.length) toast("В открытых задачах нет картинок");
      imgs.forEach((i) => translateImageFor(i, { manual: true }));
    }
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.closest(".x")) modal.hidden = true;
  });

  // ---------- Озвучка ----------

  let enVoice = null;
  function pickVoice() {
    const vs = speechSynthesis.getVoices();
    // Только голоса, работающие на компьютере (localService): онлайн-голоса отправили бы текст в интернет.
    const local = vs.filter((v) => v.localService);
    enVoice = local.find((v) => /^en-US/i.test(v.lang)) || local.find((v) => /^en/i.test(v.lang)) || null;
  }
  if ("speechSynthesis" in window) {
    pickVoice();
    speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
  }
  function speak(text) {
    if (!("speechSynthesis" in window)) return toast("Озвучка недоступна в этом браузере");
    if (!enVoice) pickVoice();
    if (!enVoice) return toast("В системе нет английского голоса");
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 300));
    u.voice = enVoice;
    u.lang = enVoice.lang;
    u.rate = 0.95;
    speechSynthesis.speak(u);
  }

  // ---------- Всплывающее окно перевода ----------

  let pop = null;
  let selBtn = null;
  const closeSelBtn = () => {
    selBtn?.remove();
    selBtn = null;
  };
  const closePop = () => {
    if (pop?._timer) clearInterval(pop._timer);
    pop?.remove();
    pop = null;
  };

  function place(el, rect) {
    const vw = innerWidth;
    const vh = innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = Math.min(Math.max(8, rect.left), vw - w - 8);
    let y = rect.bottom + 10;
    if (y + h > vh - 8) y = rect.top - h - 10;
    if (y < 8) y = Math.max(8, vh - h - 8);
    el.style.left = x + "px";
    el.style.top = y + "px";
  }

  function selectionInfo() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (!text || text.length > 3000 || !/[A-Za-z]/.test(text)) return null;
    const range = sel.getRangeAt(0);
    let node = range.commonAncestorContainer;
    if (node.nodeType !== 1) node = node.parentElement;
    if (!node || node.closest("input, textarea, [contenteditable='true']")) return null;
    const block = node.closest("p, li, td, h1, h2, h3, h4, h5, h6, blockquote, pre, [id^='question-text-']") || node;
    return { text, context: normText(block).slice(0, 1500), rect: range.getBoundingClientRect() };
  }

  async function showPopup(info, detail = false, force = false) {
    closeSelBtn();
    closePop();
    const p = document.createElement("div");
    p.className = "pop";
    p.innerHTML = `
      <div class="hd"><div class="src"></div>
        <button class="ibtn say" title="Произношение">${ICONS.speak}</button>
        <button class="ibtn x" title="Закрыть (Esc)">${ICONS.close}</button></div>
      <div class="bd"><div class="skel" style="width:70%"></div><div class="skel"></div><div class="skel" style="width:85%"></div>
        <div class="wait">Перевожу… <span class="sec">0</span> с</div></div>
      <div class="ft"></div>`;
    p.querySelector(".src").textContent = info.text;
    p.querySelector(".x").onclick = closePop;
    p.querySelector(".say").onclick = () => speak(info.text);
    $(".ui").append(p);
    pop = p;
    place(p, info.rect);
    const t0 = Date.now();
    p._timer = setInterval(() => {
      const s = p.querySelector(".sec");
      if (s) s.textContent = Math.round((Date.now() - t0) / 1000);
    }, 500);
    const res = await send({ type: "explain", text: info.text, context: info.context, title: roomTitle(), room: roomCode(), detail, force });
    if (pop !== p) return;
    clearInterval(p._timer);
    const bd = p.querySelector(".bd");
    const ft = p.querySelector(".ft");
    bd.textContent = "";
    if (!res.ok) {
      const e = document.createElement("div");
      e.className = "err";
      e.textContent = "Ошибка: " + res.error;
      bd.append(e);
      const again = mkBtn(ICONS.redo, "Повторить", () => showPopup(info, detail, force));
      ft.append(again);
      place(p, info.rect);
      return;
    }
    const tr = document.createElement("div");
    tr.className = "tr";
    tr.textContent = res.translation;
    markLang(tr);
    bd.append(tr);
    if (res.explanation) {
      const ex = document.createElement("div");
      ex.className = "ex";
      ex.textContent = res.explanation;
      markLang(ex);
      bd.append(ex);
    }
    if (res.source === "glossary") {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = "из словаря комнаты";
      bd.append(b);
    }
    if (!detail) ft.append(mkBtn("", "Подробнее", () => showPopup(info, true), true));
    if (info.text.split(" ").length <= 6) {
      ft.append(
        mkBtn(ICONS.star, "В мои слова", async () => {
          const r = await send({ type: "saveWord", word: { en: info.text, ru: res.translation, note: res.explanation, room: roomCode() } });
          toast(r.ok ? "Сохранено в «Мои слова»" : "Не удалось сохранить");
        })
      );
    }
    ft.append(
      mkBtn(ICONS.chat, "", () => {
        closePop();
        openChat(`Что значит «${info.text.slice(0, 300)}» здесь? `);
      }, false, "Спросить в чате")
    );
    ft.append(
      mkBtn(ICONS.copy, "", () => {
        navigator.clipboard.writeText(res.translation + (res.explanation ? "\n\n" + res.explanation : ""));
        toast("Скопировано");
      })
    );
    if (res.source === "glossary") {
      const sp = document.createElement("span");
      sp.className = "sp";
      // Слово есть в словаре комнаты, но можно спросить модель именно про это место.
      ft.append(sp, mkBtn(ICONS.redo, "Спросить модель", () => showPopup(info, false, true)));
    }
    place(p, info.rect);
  }

  function mkBtn(icon, label, onclick, primary = false, title = "Копировать") {
    const b = document.createElement("button");
    b.className = "btn" + (primary ? " primary" : "");
    b.innerHTML = icon;
    if (label) b.append(label);
    else b.title = title;
    b.onclick = onclick;
    return b;
  }

  // ---------- Инструменты блока и картинки при наведении ----------

  let toolsFor = null;
  let toolsHideTimer = 0;
  let hovered = null;

  function showTools(target, buttons) {
    clearTimeout(toolsHideTimer);
    tools.innerHTML = "";
    for (const [icon, label, title, fn] of buttons) {
      const b = document.createElement("button");
      b.className = "ibtn";
      b.title = title;
      b.innerHTML = icon;
      if (label) b.append(label);
      b.onclick = (e) => {
        e.stopPropagation();
        fn();
      };
      tools.append(b);
    }
    tools.hidden = false;
    const r = target.getBoundingClientRect();
    const w = tools.offsetWidth;
    const top = r.top - tools.offsetHeight - 4 > 64 ? r.top - tools.offsetHeight - 4 : r.top + 4;
    tools.style.left = Math.min(innerWidth - w - 8, Math.max(8, r.right - w)) + "px";
    tools.style.top = top + "px";
  }

  function hideTools() {
    tools.hidden = true;
    toolsFor = null;
    hovered?.classList.remove("thmru-hover");
    hovered = null;
  }

  function blockButtons(p) {
    return [
      [ICONS.eye, p.showOrig || mode === "bi" ? "Скрыть оригинал" : "Оригинал", "Показать оригинал этого абзаца", () => {
        if (mode === "bi") setMode("ru");
        else p.showOrig = !p.showOrig;
        updatePair(p);
        showTools(p.tr, blockButtons(p));
      }],
      [ICONS.redo, "", "Перевести этот абзац заново", () => retranslate(p)],
      [ICONS.help, "Объяснить", "Подробно объяснить этот абзац", () => {
        hideTools();
        showPopup({ text: normText(p.orig).slice(0, 2500), context: "", rect: p.tr.getBoundingClientRect() }, true);
      }],
    ];
  }

  async function retranslate(p) {
    p.tr.style.opacity = ".45";
    const res = await send({ type: "translate", items: [itemOf(p.orig)], title: roomTitle(), room: roomCode(), force: true });
    p.tr.style.opacity = "";
    if (res.ok) {
      fillTr(p, res.items[0]);
      toast("Абзац переведён заново");
    } else toast("Ошибка: " + res.error);
  }

  document.addEventListener(
    "mouseover",
    (e) => {
      if (e.composedPath().includes(host)) {
        clearTimeout(toolsHideTimer);
        return;
      }
      const t = e.target;
      if (!(t instanceof Element)) return;
      // Картинка в уроке
      if (t.tagName === "IMG" && roomCode() && t.closest('[class*="StyledAccordionDetailsMain"]') && (t.naturalWidth || t.width) >= 100) {
        if (toolsFor === t) return clearTimeout(toolsHideTimer);
        toolsFor = t;
        const url = imgUrl(t);
        const c = imgCards.get(url);
        const shown = c && c.card.isConnected && !c.card.hidden;
        showTools(t, [
          [ICONS.image, shown ? "Скрыть перевод" : "Перевести картинку", "Перевести текст на картинке", () => {
            if (shown) {
              c.card.hidden = true;
              c.manual = false;
            } else translateImageFor(t, { manual: true });
            hideTools();
          }],
        ]);
        return;
      }
      if (mode === "en") return;
      const el = t.closest(".thmru-tr, [data-thmru-muted]");
      const p = el && pairOf.get(el);
      if (p && p.kind === "block" && !p.static) {
        if (toolsFor === p) return clearTimeout(toolsHideTimer);
        hovered?.classList.remove("thmru-hover");
        hovered = p.tr;
        p.tr.classList.add("thmru-hover");
        toolsFor = p;
        showTools(p.tr, blockButtons(p));
        return;
      }
      if (toolsFor) {
        clearTimeout(toolsHideTimer);
        toolsHideTimer = setTimeout(hideTools, 450);
      }
    },
    true
  );
  addEventListener("scroll", () => !tools.hidden && hideTools(), { passive: true, capture: true });

  // ---------- Словарь ----------

  let drawerTab = "room";
  let drawerData = { room: [], mine: [] };

  async function openDrawer(tab) {
    if (tab) drawerTab = tab;
    drawer.hidden = false;
    const [g, w] = await Promise.all([send({ type: "getGlossary", room: roomCode() }), send({ type: "getWords" })]);
    drawerData = { room: g.terms || [], mine: w.words || [] };
    renderDrawer();
    drawer.querySelector(".search").focus();
  }

  function renderDrawer() {
    drawer.querySelectorAll(".tabs button").forEach((b) => {
      b.classList.toggle("on", b.dataset.t === drawerTab);
      const n = drawerData[b.dataset.t].length;
      b.textContent = (b.dataset.t === "room" ? "Термины комнаты" : "Мои слова") + (n ? ` · ${n}` : "");
    });
    const q = drawer.querySelector(".search").value.trim().toLowerCase();
    const list = drawer.querySelector(".list");
    const items = drawerData[drawerTab].filter((t) => !q || `${t.en} ${t.ru} ${t.note}`.toLowerCase().includes(q));
    list.textContent = "";
    if (!items.length) {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = drawerData[drawerTab].length
        ? "Ничего не найдено."
        : drawerTab === "room"
          ? "Термины появятся, когда комната переведётся. Они собираются автоматически вместе с переводом."
          : "Здесь будут слова, которые вы сохраните звёздочкой из окна перевода.";
      list.append(e);
    }
    for (const t of items) {
      const it = document.createElement("div");
      it.className = "item";
      it.innerHTML = `<div class="row"><span class="en"></span>
        <button class="ibtn say" title="Произношение">${ICONS.speak}</button>
        <button class="ibtn act" title="${drawerTab === "room" ? "В мои слова" : "Удалить"}">${drawerTab === "room" ? ICONS.star : ICONS.trash}</button></div>
        <div class="ru"></div><div class="note"></div>`;
      it.querySelector(".en").textContent = t.en;
      it.querySelector(".ru").textContent = t.ru;
      it.querySelector(".note").textContent = t.note || "";
      markLang(it.querySelector(".ru"));
      markLang(it.querySelector(".note"));
      it.querySelector(".say").onclick = () => speak(t.en);
      it.querySelector(".act").onclick = async () => {
        if (drawerTab === "room") {
          const r = await send({ type: "saveWord", word: { ...t, room: roomCode() } });
          if (r.ok) drawerData.mine = r.words;
          toast("Сохранено в «Мои слова»");
        } else {
          const r = await send({ type: "deleteWord", en: t.en });
          if (r.ok) drawerData.mine = r.words;
        }
        renderDrawer();
      };
      list.append(it);
    }
    const foot = drawer.querySelector(".foot");
    foot.textContent = "";
    if (drawerTab === "mine" && drawerData.mine.length) {
      const b = document.createElement("button");
      b.textContent = "Экспорт в CSV (Anki, Quizlet)";
      b.onclick = () => exportCsv(drawerData.mine);
      foot.append(b);
    }
    foot.hidden = !foot.childElementCount;
  }

  function exportCsv(words) {
    const esc = (s) => `"${String(s || "").replace(/"/g, '""')}"`;
    const csv = "﻿" + words.map((w) => [w.en, w.ru, w.note].map(esc).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "thm-moi-slova.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  drawer.querySelector(".dclose").onclick = () => (drawer.hidden = true);
  drawer.querySelector(".search").addEventListener("input", renderDrawer);
  drawer.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => ((drawerTab = b.dataset.t), renderDrawer())));
  $(".dict").onclick = () => (drawer.hidden ? openDrawer() : (drawer.hidden = true));

  // ---------- Мини-чат с наставником ----------

  const msgsEl = chatEl.querySelector(".msgs");
  const chipsEl = chatEl.querySelector(".chips");
  const ta = chatEl.querySelector("textarea");
  const goBtn = chatEl.querySelector(".go");
  const CHIPS = [
    "Объясни эту задачу простыми словами",
    "Что от меня требуется в этом задании?",
    "Какие термины здесь главные?",
    "Дай наводку к вопросам, без готовых ответов",
  ];
  let chat = { room: null, id: "", messages: [] }; // messages: {role: "user"|"bot", text}
  let chatPort = null;
  let chatBusy = false;
  let ridN = 1;
  const pendingChat = new Map(); // rid -> {bubble, text, timer}

  const chatKey = () => "chat:" + (roomCode() || "general");

  async function loadChat() {
    const room = roomCode() || "general";
    if (chat.room === room) return;
    let saved = null;
    try {
      saved = (await chrome.storage.local.get(chatKey()))[chatKey()];
    } catch {
      markDead();
    }
    chat = saved?.id ? { room, id: saved.id, messages: saved.messages || [] } : { room, id: `${room}-${Date.now().toString(36)}`, messages: [] };
    renderChat();
  }

  function saveChat() {
    try {
      chrome.storage.local.set({ [chatKey()]: { id: chat.id, messages: chat.messages.slice(-40) } });
    } catch {
      /* расширение перезагружено */
    }
  }

  function inlineMd(parent, text) {
    const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.append(text.slice(last, m.index));
      const t = m[0];
      const el = document.createElement(t[0] === "`" ? "code" : "b");
      el.textContent = t[0] === "`" ? t.slice(1, -1) : t.slice(2, -2);
      parent.append(el);
      last = re.lastIndex;
    }
    if (last < text.length) parent.append(text.slice(last));
  }

  // Маленький безопасный «markdown»: блоки кода, списки, заголовки, `код`, **жирный**. Только DOM, без innerHTML.
  function renderMd(el, text) {
    el.textContent = "";
    markLang(el); // ответы модели — на языке перевода
    text.split("```").forEach((part, i) => {
      if (i % 2 === 1) {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = part.replace(/^[a-z0-9+#-]*\n/i, "").replace(/\n$/, "");
        pre.append(code);
        el.append(pre);
        return;
      }
      let ul = null;
      let para = [];
      const flush = () => {
        if (!para.length) return;
        const p = document.createElement("p");
        para.forEach((l, j) => {
          if (j) p.append(document.createElement("br"));
          inlineMd(p, l);
        });
        el.append(p);
        para = [];
      };
      for (const raw of part.split("\n")) {
        const line = raw.trimEnd();
        const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
        if (li) {
          flush();
          if (!ul) el.append((ul = document.createElement("ul")));
          const x = document.createElement("li");
          inlineMd(x, li[1]);
          ul.append(x);
          continue;
        }
        ul = null;
        if (!line.trim()) {
          flush();
          continue;
        }
        const h = line.match(/^#{1,4}\s+(.*)$/);
        if (h) {
          flush();
          const p = document.createElement("p");
          const b = document.createElement("b");
          inlineMd(b, h[1]);
          p.append(b);
          el.append(p);
          continue;
        }
        para.push(line);
      }
      flush();
    });
  }

  function addBubble(role, text) {
    const b = document.createElement("div");
    b.className = "msg " + role;
    if (role === "user") b.textContent = text;
    else if (text === null) b.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    else renderMd(b, text);
    msgsEl.append(b);
    scrollChat();
    return b;
  }

  const scrollChat = () => (msgsEl.scrollTop = msgsEl.scrollHeight);

  function renderChat() {
    msgsEl.textContent = "";
    if (!chat.messages.length) {
      const intro = document.createElement("div");
      intro.className = "intro";
      intro.textContent =
        "Спросите что угодно по уроку — наставник видит текст открытой задачи и её вопросы. Отвечает на выбранном языке, с примерами. К вопросам задания сначала даёт наводку.";
      msgsEl.append(intro);
    }
    for (const m of chat.messages) addBubble(m.role, m.text);
    chipsEl.textContent = "";
    chipsEl.hidden = !!chat.messages.length;
    for (const c of CHIPS) {
      const b = document.createElement("button");
      b.textContent = c;
      b.onclick = () => ask(c);
      chipsEl.append(b);
    }
  }

  function currentTaskContext() {
    const regions = [...document.querySelectorAll('[id^="content-"][role="region"]')];
    if (!regions.length) return { label: roomCode() ? roomTitle() : "TryHackMe", text: roomCode() ? `Комната: ${roomTitle()}` : "" };
    // Задача, которая ближе всего к центру экрана.
    const mid = innerHeight / 2;
    let best = regions[0];
    let bd = Infinity;
    for (const r of regions) {
      const b = r.getBoundingClientRect();
      const vis = b.bottom > 0 && b.top < innerHeight;
      const d = vis ? Math.abs((Math.max(b.top, 0) + Math.min(b.bottom, innerHeight)) / 2 - mid) : 1e6 + Math.abs(b.top - mid);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    const n = best.id.split("-")[1];
    const titleEl = document.querySelector(`#header-${n} [class*="StyledTaskTitle"]:not(.thmru-tr)`);
    const taskTitle = titleEl ? normText(titleEl) : "";
    const main = best.querySelector('[class*="StyledAccordionDetailsMain"]');
    let text = "";
    if (main) {
      const c = main.cloneNode(true);
      c.querySelectorAll(".thmru-tr, .thmru-img-card, script, style, svg").forEach((x) => x.remove());
      const blocks = [...c.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, pre, td, th, blockquote")].filter(
        (e) => !e.parentElement.closest("p, li, pre, td, th, blockquote")
      );
      text = (blocks.length ? blocks.map((e) => (e.tagName === "PRE" ? e.textContent : normText(e))) : [normText(c)]).join("\n");
    }
    const qs = [...best.querySelectorAll('[id^="question-text-"]:not(.thmru-tr)')].map((q) => "- " + normText(q));
    const pics = [...best.querySelectorAll("img")]
      .map((i) => imgKnown.get(imgUrl(i))?.summary)
      .filter(Boolean)
      .map((x) => "- " + x);
    return {
      label: `Задача ${n}${taskTitle ? ": " + taskTitle : ""}`,
      text:
        `Комната: ${roomTitle()}\nЗадача ${n}: ${taskTitle}\n\nТекст задачи (оригинал):\n${text.slice(0, 9000)}` +
        (qs.length ? `\n\nВопросы задачи:\n${qs.join("\n")}` : "") +
        (pics.length ? `\n\nКартинки в задаче:\n${pics.join("\n")}` : ""),
    };
  }

  function chatPortGet() {
    if (chatPort) return chatPort;
    chatPort = chrome.runtime.connect({ name: "thmru-chat" });
    chatPort.onMessage.addListener((m) => {
      const p = pendingChat.get(m.rid);
      if (!p) return;
      if (m.delta) {
        p.text += m.delta;
        if (!p.timer) p.timer = setTimeout(() => ((p.timer = 0), renderMd(p.bubble, p.text), scrollChat()), 60);
      }
      if ("ok" in m) finishAnswer(m.rid, m);
    });
    chatPort.onDisconnect.addListener(() => {
      chatPort = null;
      for (const rid of [...pendingChat.keys()]) finishAnswer(rid, { ok: false, error: "Соединение прервалось — спросите ещё раз" });
    });
    return chatPort;
  }

  function finishAnswer(rid, m) {
    const p = pendingChat.get(rid);
    if (!p) return;
    pendingChat.delete(rid);
    clearTimeout(p.timer);
    chatBusy = false;
    goBtn.disabled = false;
    if (m.ok) {
      const text = m.text || p.text;
      renderMd(p.bubble, text);
      if (m.cached) {
        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = "мгновенно — из кэша";
        p.bubble.append(meta);
      }
      chat.messages.push({ role: "bot", text });
      saveChat();
    } else {
      p.bubble.className = "msg err";
      p.bubble.textContent = "Не получилось: " + (m.error || "нет ответа");
    }
    scrollChat();
  }

  function ask(text) {
    text = (text || "").trim();
    if (!text || chatBusy) return;
    const ctx = currentTaskContext();
    chatEl.querySelector(".ctx").textContent = ctx.label;
    const history = chat.messages.slice(-10);
    chat.messages.push({ role: "user", text });
    saveChat();
    msgsEl.querySelector(".intro")?.remove();
    chipsEl.hidden = true;
    addBubble("user", text);
    const bubble = addBubble("bot", null);
    const rid = ridN++;
    pendingChat.set(rid, { bubble, text: "", timer: 0 });
    chatBusy = true;
    goBtn.disabled = true;
    ta.value = "";
    autoGrow();
    try {
      chatPortGet().postMessage({ type: "ask", rid, chatId: chat.id, room: roomCode(), text, context: ctx.text, history });
    } catch {
      markDead();
      finishAnswer(rid, { ok: false, error: DEAD_MSG });
    }
  }

  async function openChat(prefill) {
    drawer.hidden = true;
    chatEl.hidden = false;
    await loadChat();
    chatEl.querySelector(".ctx").textContent = currentTaskContext().label;
    if (prefill) ta.value = prefill;
    autoGrow();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    scrollChat();
  }

  function autoGrow() {
    ta.style.height = "auto";
    ta.style.height = Math.min(140, ta.scrollHeight) + "px";
  }

  ta.addEventListener("input", autoGrow);
  ta.addEventListener("keydown", (e) => {
    e.stopPropagation(); // не отдаём клавиши сайту (у TryHackMe свои сочетания)
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      ask(ta.value);
    }
    if (e.key === "Escape") chatEl.hidden = true;
  });
  goBtn.onclick = () => ask(ta.value);
  chatEl.querySelector(".cclose").onclick = () => (chatEl.hidden = true);
  chatEl.querySelector(".cnew").onclick = () => {
    if (chatBusy) return;
    try {
      chatPortGet().postMessage({ type: "reset", chatId: chat.id });
    } catch {
      /* не важно */
    }
    chat = { room: chat.room, id: `${chat.room}-${Date.now().toString(36)}`, messages: [] };
    saveChat();
    renderChat();
    ta.focus();
  };
  $(".chatbtn").onclick = () => (chatEl.hidden ? openChat() : (chatEl.hidden = true));

  // ---------- Выделение ----------

  document.addEventListener("mouseup", (e) => {
    if (e.composedPath().includes(host) || e.button !== 0) return;
    setTimeout(() => {
      const info = selectionInfo();
      closeSelBtn();
      if (!info) return;
      selBtn = document.createElement("button");
      selBtn.className = "selbtn";
      selBtn.textContent = LANG.short;
      selBtn.title = "Перевести и объяснить (Alt+T)";
      selBtn.onmousedown = (ev) => ev.preventDefault(); // не сбрасывать выделение
      selBtn.onclick = () => showPopup(info);
      $(".ui").append(selBtn);
      const r = info.rect;
      selBtn.style.left = Math.min(innerWidth - 50, Math.max(8, r.right - 4)) + "px";
      selBtn.style.top = Math.max(8, r.top - 30) + "px";
    }, 10);
  });

  document.addEventListener("mousedown", (e) => {
    const inside = e.composedPath().includes(host);
    if (!inside) {
      closeSelBtn();
      closePop();
      closeMenu();
    } else if (!e.composedPath().includes(menu) && !e.composedPath().includes($(".more"))) closeMenu();
  });

  // ---------- Клавиши ----------

  let altTimer = 0;
  let altCombo = false;
  addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        closeSelBtn();
        closePop();
        closeMenu();
        hideTools();
        drawer.hidden = true;
        modal.hidden = true;
        chatEl.hidden = true;
      }
      if (e.key === "Alt") {
        altCombo = false;
        clearTimeout(altTimer);
        if (mode !== "en") altTimer = setTimeout(() => !altCombo && document.documentElement.classList.add("thmru-peek"), 350);
        return;
      }
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      altCombo = true;
      clearTimeout(altTimer);
      document.documentElement.classList.remove("thmru-peek");
      const inField = e.target.closest?.("input, textarea, [contenteditable='true']");
      if (e.code === "KeyR" && roomCode()) {
        e.preventDefault();
        setMode(mode === "en" ? settings.lastTr || "ru" : "en");
      } else if (e.code === "KeyB" && roomCode()) {
        e.preventDefault();
        setMode(mode === "bi" ? "ru" : "bi");
      } else if (e.code === "KeyC") {
        e.preventDefault();
        chatEl.hidden ? openChat() : (chatEl.hidden = true);
      } else if (e.code === "KeyD") {
        e.preventDefault();
        drawer.hidden ? openDrawer() : (drawer.hidden = true);
      } else if (e.code === "KeyT" && !inField) {
        const info = selectionInfo();
        if (info) {
          e.preventDefault();
          showPopup(info);
        }
      }
    },
    true
  );
  addEventListener("keyup", (e) => {
    if (e.key === "Alt") {
      clearTimeout(altTimer);
      document.documentElement.classList.remove("thmru-peek");
    }
  });
  addEventListener("blur", () => {
    clearTimeout(altTimer);
    document.documentElement.classList.remove("thmru-peek");
  });

  // ---------- Сообщения от фона (контекстное меню) ----------

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "explainSelection") {
      const info = selectionInfo() || {
        text: msg.text,
        context: "",
        rect: { left: innerWidth / 2 - 220, right: innerWidth / 2, top: 120, bottom: 120 },
      };
      showPopup(info);
    }
    if (msg.type === "translateImageAt") {
      const img = [...document.querySelectorAll("img")].find((i) => i.src === msg.src || i.currentSrc === msg.src);
      if (img) {
        translateImageFor(img, { manual: true });
        img.scrollIntoView({ block: "nearest" });
      } else toast("Картинка не найдена на странице");
    }
  });

  // ---------- Наблюдение за страницей ----------

  let lastPath = location.pathname;
  let scheduled = false;
  const ours = (n) => n.nodeType !== 1 || n.classList?.contains("thmru-tr") || n.classList?.contains("thmru-img-card") || n === host;
  const observer = new MutationObserver((muts) => {
    if (muts.every((m) => [...m.addedNodes].every(ours) && [...m.removedNodes].every(ours))) return;
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        errorText = "";
        imgChecked.clear();
        render();
      }
      cleanupOrphans();
      translateVisible();
      if (roomCode() && prep?.room !== roomCode()) {
        prefetchRoom();
      }
    }, 350);
  });

  // ---------- Запуск ----------

  (async () => {
    root.host.style.setProperty("--font", getComputedStyle(document.body).fontFamily);
    $(".ui").style.setProperty("--font", getComputedStyle(document.body).fontFamily);
    document.documentElement.appendChild(host);
    const r = await send({ type: "getSettings" });
    if (r.ok) settings = r.settings;
    LANG = languageInfo(settings.targetLang);
    $('.seg button[data-m="ru"]').textContent = LANG.short;
    $('.seg button[data-m="bi"]').textContent = LANG.short + "+EN";
    mode = settings.mode || "en";
    placePanel();
    render();
    addEventListener("resize", placePanel);
    observer.observe(document.body, { childList: true, subtree: true });
    if (mode !== "en") translateVisible();
    prefetchRoom();
  })();
})();
