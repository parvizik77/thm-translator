const FIELDS = ["targetLang", "localUrl", "localModel", "mode", "prefetchNext"];
const SWITCHES = ["prefetch", "prefetchImages", "translateChat"];
const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const show = (el, text, cls = "") => {
  el.textContent = text;
  el.className = "msg " + cls;
};

// ---------- Вкладки ----------
document.querySelectorAll("nav button").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("on", x === b));
    document.querySelectorAll("section").forEach((s) => s.classList.toggle("on", s.id === b.dataset.tab));
    $("save").parentElement.style.display = ["model", "behavior"].includes(b.dataset.tab) ? "" : "none";
    if (b.dataset.tab === "words") loadWords();
    if (b.dataset.tab === "data") loadStats();
    history.replaceState(null, "", "#" + b.dataset.tab);
  };
});

// ---------- Язык ----------
for (const [code, name, native] of LANGUAGES) {
  const o = document.createElement("option");
  o.value = code;
  o.textContent = native === name ? name : `${native} — ${name}`;
  $("targetLang").append(o);
}

// ---------- Модели локального сервера ----------
document.querySelectorAll(".preset").forEach((b) => (b.onclick = () => ($("localUrl").value = b.dataset.url)));

async function loadModels() {
  await save();
  show($("smsg"), "Ищу модели…");
  const r = await send({ type: "models" });
  if (!r.ok) return show($("smsg"), "Сервер не ответил: " + r.error, "bad");
  $("modelList").innerHTML = "";
  for (const id of r.models) {
    const o = document.createElement("option");
    o.value = id;
    $("modelList").append(o);
  }
  show($("smsg"), r.models.length ? "Модели на сервере: " + r.models.join(", ") : "Сервер не сообщил ни одной модели", r.models.length ? "ok" : "bad");
}
$("loadModels").onclick = () => loadModels();

// ---------- Загрузка / сохранение ----------
let current = {};
async function load() {
  const { settings: s } = await send({ type: "getSettings" });
  current = s;
  for (const f of FIELDS) $(f).value = String(s[f] ?? "");
  for (const f of SWITCHES) $(f).checked = s[f] !== false;
}

async function save() {
  const patch = {};
  for (const f of FIELDS) patch[f] = $(f).value.trim();
  patch.prefetchNext = Number(patch.prefetchNext);
  for (const f of SWITCHES) patch[f] = $(f).checked;
  await send({ type: "setSettings", patch });
  show($("smsg"), "Сохранено.", "ok");
  setTimeout(() => show($("smsg"), ""), 2500);
}

$("save").onclick = save;

// ---------- Проверка ----------
$("test").onclick = async () => {
  await save();
  show($("tmsg"), "Проверяю… Первый ответ локальной модели может занять несколько секунд.");
  const r = await send({ type: "test" });
  if (r.ok) show($("tmsg"), `Работает: ${(r.ms / 1000).toFixed(1)} с. «port» → ${r.sample}`, "ok");
  else show($("tmsg"), "Ошибка: " + r.error, "bad");
};

// ---------- Мои слова ----------
let words = [];
async function loadWords() {
  words = (await send({ type: "getWords" })).words || [];
  renderWords();
}
function renderWords() {
  const q = $("wq").value.trim().toLowerCase();
  const list = $("wlist");
  list.textContent = "";
  const items = words.filter((w) => !q || `${w.en} ${w.ru} ${w.note}`.toLowerCase().includes(q));
  if (!items.length) {
    list.innerHTML = `<p class="hint">${words.length ? "Ничего не найдено." : "Пока пусто. Сохраняйте слова звёздочкой в окне перевода."}</p>`;
    return;
  }
  for (const w of items) {
    const d = document.createElement("div");
    d.className = "w";
    d.innerHTML = '<div class="en"></div><button title="Удалить">×</button><div class="ru"></div><div class="note"></div>';
    d.querySelector(".en").textContent = w.en + (w.room ? `  · ${w.room}` : "");
    d.querySelector(".ru").textContent = w.ru;
    d.querySelector(".note").textContent = w.note || "";
    d.querySelector("button").onclick = async () => {
      words = (await send({ type: "deleteWord", en: w.en })).words || [];
      renderWords();
    };
    list.append(d);
  }
}
$("wq").addEventListener("input", renderWords);
$("export").onclick = () => {
  const esc = (s) => `"${String(s || "").replace(/"/g, '""')}"`;
  const csv = "﻿" + words.map((w) => [w.en, w.ru, w.note].map(esc).join(";")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = "thm-moi-slova.csv";
  a.click();
};

// ---------- Данные ----------
async function loadStats() {
  const s = await send({ type: "cacheStats" });
  const items = [
    [s.entries, "переводов в кэше"],
    [s.kb + " КБ", "занимают"],
    [s.rooms, "словарей комнат"],
    [s.words, "моих слов"],
  ];
  $("stats").innerHTML = items.map(([n, l]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("");
}
let clearArmed = false;
$("clear").onclick = async () => {
  if (!clearArmed) {
    clearArmed = true;
    $("clear").textContent = "Точно? Нажмите ещё раз";
    return;
  }
  clearArmed = false;
  $("clear").textContent = "Очистить переводы и словари комнат";
  const r = await send({ type: "clearCache" });
  show($("dmsg"), r.ok ? `Удалено записей: ${r.removed}` : "Ошибка: " + r.error, r.ok ? "ok" : "bad");
  loadStats();
};

// ---------- Резервная копия ----------
$("backup").onclick = async () => {
  const r = await send({ type: "exportData" });
  if (!r.ok) return show($("bmsg"), "Ошибка: " + r.error, "bad");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(r.backup)], { type: "application/json" }));
  a.download = `thm-perevodchik-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  show($("bmsg"), "Копия скачана.", "ok");
};
$("restore").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const r = await send({ type: "importData", backup: JSON.parse(await f.text()) });
    show($("bmsg"), r.ok ? `Восстановлено записей: ${r.count}` : "Ошибка: " + r.error, r.ok ? "ok" : "bad");
    loadStats();
  } catch {
    show($("bmsg"), "Файл не читается как резервная копия", "bad");
  }
  e.target.value = "";
};

// ---------- Старт ----------
load().then(() => {
  const tab = location.hash.slice(1);
  document.querySelector(`nav button[data-tab="${tab}"]`)?.click();
});
