// Simulator: runs the real content.js on a demo lesson with a fake chrome.* API.
// Model answers below are pre-recorded; in the real extension they come from your local model.
(() => {
  const params = new URLSearchParams(location.search);
  const LANG = ["ru", "es", "ar", "ja"].includes(params.get("lang")) ? params.get("lang") : "ru";
  window.THMRU_DEMO_ROOM = "ports-demo";

  // English text of a block → translation (HTML) per language.
  const T = {
    "Learn what network ports are and how attackers find open services.": {
      ru: "Узнайте, что такое сетевые порты и как злоумышленники находят открытые службы.",
      es: "Aprende qué son los puertos de red y cómo los atacantes encuentran servicios abiertos.",
      ar: "تعرّف على منافذ الشبكة وكيف يعثر المهاجمون على الخدمات المفتوحة.",
      ja: "ネットワークポートとは何か、攻撃者が開いているサービスをどう見つけるかを学びます。",
    },
    "What is a port?": { ru: "Что такое порт?", es: "¿Qué es un puerto?", ar: "ما هو المنفذ؟", ja: "ポートとは？" },
    "Scanning safely": { ru: "Безопасное сканирование", es: "Escaneo seguro", ar: "الفحص الآمن", ja: "安全なスキャン" },
    "A port is a number that tells the operating system which program should receive incoming network traffic.": {
      ru: "<b>Порт</b> (port) — это число, по которому операционная система понимает, какой программе передать входящий сетевой трафик.",
      es: "Un <b>puerto</b> (port) es un número que le indica al sistema operativo qué programa debe recibir el tráfico de red entrante.",
      ar: "<b>المنفذ</b> (port) هو رقم يخبر نظام التشغيل بالبرنامج الذي يجب أن يستقبل حركة مرور الشبكة الواردة.",
      ja: "<b>ポート</b>（port）とは、受信したネットワーク通信をどのプログラムに渡すかを OS に伝える番号です。",
    },
    "Each service listens on its own port: web servers usually use port 80 for HTTP and 443 for HTTPS, while SSH listens on port 22.": {
      ru: "Каждая служба слушает свой порт: веб-серверы обычно используют порт <code>80</code> для HTTP и <code>443</code> для HTTPS, а SSH слушает порт <code>22</code>.",
      es: "Cada servicio escucha en su propio puerto: los servidores web suelen usar el puerto <code>80</code> para HTTP y el <code>443</code> para HTTPS, mientras que SSH escucha en el puerto <code>22</code>.",
      ar: "كل خدمة تستمع على منفذها الخاص: تستخدم خوادم الويب عادةً المنفذ <code>80</code> لـ HTTP والمنفذ <code>443</code> لـ HTTPS، بينما تستمع SSH على المنفذ <code>22</code>.",
      ja: "各サービスはそれぞれのポートで待ち受けます。Web サーバーは通常、HTTP にポート <code>80</code>、HTTPS にポート <code>443</code> を使い、SSH はポート <code>22</code> で待ち受けます。",
    },
    "Attackers often start with a port scan to find out which services are exposed. A popular tool for this is Nmap:": {
      ru: "Злоумышленники часто начинают со <b>сканирования портов</b> (port scan), чтобы узнать, какие службы доступны снаружи. Популярный инструмент для этого — Nmap:",
      es: "Los atacantes suelen empezar con un <b>escaneo de puertos</b> (port scan) para averiguar qué servicios están expuestos. Una herramienta popular para esto es Nmap:",
      ar: "غالبًا ما يبدأ المهاجمون <b>بفحص المنافذ</b> (port scan) لمعرفة الخدمات المكشوفة. من الأدوات الشائعة لذلك أداة Nmap:",
      ja: "攻撃者はまず<b>ポートスキャン</b>（port scan）を行い、どのサービスが外部に公開されているかを調べることがよくあります。これによく使われるツールが Nmap です：",
    },
    "The -sV flag asks Nmap to detect the version of each service, which helps you look for known vulnerabilities.": {
      ru: "Флаг <code>-sV</code> просит Nmap определить версию каждой службы — это помогает искать известные уязвимости.",
      es: "La opción <code>-sV</code> le pide a Nmap que detecte la versión de cada servicio, lo que ayuda a buscar vulnerabilidades conocidas.",
      ar: "يطلب الخيار <code>-sV</code> من Nmap اكتشاف إصدار كل خدمة، مما يساعدك على البحث عن الثغرات المعروفة.",
      ja: "<code>-sV</code> オプションは、各サービスのバージョンを検出するよう Nmap に指示します。既知の脆弱性を探すのに役立ちます。",
    },
    "Which port does SSH use by default?": {
      ru: "Какой порт SSH использует по умолчанию?",
      es: "¿Qué puerto usa SSH por defecto?",
      ar: "ما المنفذ الذي تستخدمه SSH افتراضيًا؟",
      ja: "SSH がデフォルトで使うポートは？",
    },
  };

  const IMAGE = {
    texts: [
      ["Open port", { ru: "Открытый порт", es: "Puerto abierto", ar: "منفذ مفتوح", ja: "開いているポート" }],
      ["Closed port", { ru: "Закрытый порт", es: "Puerto cerrado", ar: "منفذ مغلق", ja: "閉じているポート" }],
      ["Client", { ru: "Клиент", es: "Cliente", ar: "العميل", ja: "クライアント" }],
      ["Firewall", { ru: "Межсетевой экран (firewall)", es: "Cortafuegos (firewall)", ar: "جدار الحماية (firewall)", ja: "ファイアウォール（firewall）" }],
      ["Web server :443", { ru: "Веб-сервер :443", es: "Servidor web :443", ar: "خادم الويب :443", ja: "Web サーバー :443" }],
      ["SSH server :22", { ru: "SSH-сервер :22", es: "Servidor SSH :22", ar: "خادم SSH :22", ja: "SSH サーバー :22" }],
      ["Database :3306", { ru: "База данных :3306", es: "Base de datos :3306", ar: "قاعدة البيانات :3306", ja: "データベース :3306" }],
    ],
    summary: {
      ru: "Схема: запрос клиента проходит через межсетевой экран и попадает на нужную службу по номеру порта. Открытые порты видны снаружи — именно их находит сканирование.",
      es: "Diagrama: la petición del cliente pasa por el cortafuegos y llega al servicio correcto según el número de puerto. Los puertos abiertos se ven desde fuera, y eso es lo que encuentra un escaneo.",
      ar: "مخطط: يمر طلب العميل عبر جدار الحماية ويصل إلى الخدمة الصحيحة حسب رقم المنفذ. المنافذ المفتوحة مرئية من الخارج، وهذا ما يكشفه الفحص.",
      ja: "図：クライアントの要求はファイアウォールを通り、ポート番号に応じて正しいサービスに届きます。開いているポートは外部から見え、スキャンで見つかるのはこれです。",
    },
  };

  const GLOSSARY = [
    ["port", { ru: ["порт", "Номер, по которому система передаёт трафик нужной программе."], es: ["puerto", "Número con el que el sistema envía el tráfico al programa correcto."], ar: ["منفذ", "رقم يوجّه به النظام حركة المرور إلى البرنامج الصحيح."], ja: ["ポート", "システムが通信を正しいプログラムに振り分けるための番号。"] }],
    ["port scan", { ru: ["сканирование портов", "Проверка, какие порты машины открыты и какие службы на них работают."], es: ["escaneo de puertos", "Comprobar qué puertos de una máquina están abiertos y qué servicios corren en ellos."], ar: ["فحص المنافذ", "التحقق من المنافذ المفتوحة على جهاز والخدمات التي تعمل عليها."], ja: ["ポートスキャン", "マシンのどのポートが開いていて、どのサービスが動いているかを調べること。"] }],
    ["firewall", { ru: ["межсетевой экран", "Фильтр, который решает, какой трафик пропустить."], es: ["cortafuegos", "Filtro que decide qué tráfico se deja pasar."], ar: ["جدار الحماية", "مرشّح يقرر أي حركة مرور يُسمح بمرورها."], ja: ["ファイアウォール", "どの通信を通すかを決めるフィルター。"] }],
    ["-sV", { ru: ["определение версий служб", "Nmap узнаёт, какая программа и какой версии слушает порт."], es: ["detección de versiones", "Nmap averigua qué programa y qué versión escucha en el puerto."], ar: ["اكتشاف الإصدار", "يكتشف Nmap البرنامج الذي يستمع على المنفذ وإصداره."], ja: ["バージョン検出", "Nmap がポートで待ち受けるプログラムとそのバージョンを特定する機能。"] }],
  ];

  const DETAIL = {
    ru: "Сканирование портов — это проверка, какие «двери» компьютера открыты. Сканер, например Nmap, по очереди обращается к портам и смотрит на ответ: порт открыт, закрыт или отфильтрован межсетевым экраном.\n\nПример: `nmap -p 1-1000 10.10.10.10` проверит первые 1000 портов. Сканируйте только свои машины или машины учебной лаборатории.",
    es: "Un escaneo de puertos comprueba qué «puertas» de un ordenador están abiertas. Un escáner como Nmap contacta los puertos uno por uno y mira la respuesta: abierto, cerrado o filtrado por un cortafuegos.\n\nEjemplo: `nmap -p 1-1000 10.10.10.10` revisa los primeros 1000 puertos. Escanea solo tus propias máquinas o las del laboratorio.",
    ar: "فحص المنافذ هو التحقق من «الأبواب» المفتوحة في الحاسوب. تتصل أداة مثل Nmap بالمنافذ واحدًا تلو الآخر وتنظر في الرد: مفتوح أو مغلق أو محجوب بجدار الحماية.\n\nمثال: ‎`nmap -p 1-1000 10.10.10.10`‎ يفحص أول 1000 منفذ. افحص أجهزتك أو أجهزة المختبر التعليمي فقط.",
    ja: "ポートスキャンとは、コンピューターのどの「扉」が開いているかを調べることです。Nmap などのスキャナーはポートに順番に接続し、応答から「開いている」「閉じている」「ファイアウォールで遮断」を判断します。\n\n例：`nmap -p 1-1000 10.10.10.10` は最初の 1000 ポートを調べます。スキャンは自分のマシンか演習環境のマシンだけにしてください。",
  };

  const CHAT = {
    q: "What is a port, in simple words?",
    ru: "**Порт** — это номер «двери», через которую программа принимает соединения. По умолчанию SSH слушает порт `22`, а веб-сервер — `80` (HTTP) и `443` (HTTPS).\n\nНаводка к вопросу задачи: загляните во второй абзац урока — там перечислены стандартные порты.",
    es: "Un **puerto** es el número de la «puerta» por la que un programa acepta conexiones. Por defecto SSH escucha en el puerto `22` y un servidor web en `80` (HTTP) y `443` (HTTPS).\n\nPista para la pregunta: mira el segundo párrafo de la lección, ahí aparecen los puertos estándar.",
    ar: "**المنفذ** هو رقم «الباب» الذي يستقبل منه البرنامج الاتصالات. افتراضيًا تستمع SSH على المنفذ `22`، وخادم الويب على `80` (HTTP) و`443` (HTTPS).\n\nتلميح للسؤال: انظر إلى الفقرة الثانية من الدرس، ففيها المنافذ القياسية.",
    ja: "**ポート**とは、プログラムが接続を受け付ける「扉」の番号です。SSH はデフォルトでポート `22`、Web サーバーは `80`（HTTP）と `443`（HTTPS）で待ち受けます。\n\n問題のヒント：レッスンの 2 段落目に標準的なポートが載っています。",
  };

  const NO_ANSWER = {
    ru: "В симуляторе ответы записаны заранее только для терминов урока: port, port scan, firewall, -sV.",
    es: "En el simulador solo hay respuestas grabadas para los términos de la lección: port, port scan, firewall, -sV.",
    ar: "في المحاكي توجد إجابات مسجلة مسبقًا لمصطلحات الدرس فقط: port وport scan وfirewall و-sV.",
    ja: "シミュレーターでは、レッスンの用語（port、port scan、firewall、-sV）の回答だけが事前に用意されています。",
  };

  // ---------- fake chrome.* ----------
  const norm = (html) => {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d.textContent.replace(/\s+/g, " ").trim();
  };
  const terms = () => GLOSSARY.map(([en, tr]) => ({ en, ru: tr[LANG][0], note: tr[LANG][1] }));
  let settings = {
    targetLang: LANG,
    mode: params.get("mode") || "ru",
    lastTr: "ru",
    prefetch: false,
    prefetchImages: true,
    prefetchNext: 0,
    translateChat: true,
    panel: null,
  };
  let words = [];
  const store = {};
  const onMessage = [];

  const handlers = {
    getSettings: () => ({ settings }),
    setSettings: (m) => ((settings = { ...settings, ...m.patch }), { settings }),
    translate: (m) => ({ items: m.items.map((it) => T[norm(it.html)]?.[LANG] ?? it.html) }),
    getGlossary: () => ({ terms: terms() }),
    getWords: () => ({ words }),
    saveWord: (m) => ((words = [...words.filter((w) => w.en !== m.word.en), m.word]), { words }),
    deleteWord: (m) => ((words = words.filter((w) => w.en !== m.en)), { words }),
    explain: (m) => {
      const t = terms().find((x) => x.en.toLowerCase() === m.text.trim().toLowerCase());
      if (!t) return { translation: m.text, explanation: NO_ANSWER[LANG] };
      if (m.detail) return { translation: t.ru, explanation: DETAIL[LANG] };
      return { translation: t.ru, explanation: t.note, source: "glossary", term: t.en };
    },
    cachedImage: () => ({ result: imageResult() }),
    translateImage: () => imageResult(),
    openOptions: () => ({}),
  };
  const imageResult = () => ({ texts: IMAGE.texts.map(([en, tr]) => ({ en, ru: tr[LANG] })), summary: IMAGE.summary[LANG] });
  const delay = { translate: 700, explain: 500, translateImage: 900 };

  window.chrome = {
    runtime: {
      lastError: undefined,
      sendMessage(msg, cb) {
        const h = handlers[msg?.type];
        setTimeout(() => cb(h ? { ok: true, ...h(msg) } : { ok: false, error: "not in simulator" }), delay[msg?.type] ?? 120);
      },
      connect() {
        const ls = [];
        return {
          onMessage: { addListener: (f) => ls.push(f) },
          onDisconnect: { addListener() {} },
          postMessage(m) {
            if (m.type !== "ask") return;
            const text = CHAT[LANG];
            const parts = text.match(/.{1,12}/gs);
            parts.forEach((delta, i) => setTimeout(() => ls.forEach((f) => f({ rid: m.rid, delta })), 400 + i * 35));
            setTimeout(() => ls.forEach((f) => f({ rid: m.rid, ok: true, done: true, text })), 450 + parts.length * 35);
          },
        };
      },
      onMessage: { addListener: (f) => onMessage.push(f) },
    },
    storage: {
      local: {
        get: async (k) => (typeof k === "string" ? (k in store ? { [k]: store[k] } : {}) : { ...store }),
        set: async (o) => Object.assign(store, o),
      },
    },
  };

  // ---------- simulator bar ----------
  const shadow = () => document.querySelector("body > *:last-child")?.shadowRoot || [...document.documentElement.children].find((n) => n.shadowRoot)?.shadowRoot;
  const ui = (sel) => shadow()?.querySelector(sel);

  addEventListener("DOMContentLoaded", () => {
    const sel = document.getElementById("simLang");
    for (const [code, label] of [["ru", "Русский"], ["es", "Español"], ["ar", "العربية"], ["ja", "日本語"]]) {
      const o = new Option(label, code);
      sel.append(o);
    }
    sel.value = LANG;
    sel.onchange = () => {
      params.set("lang", sel.value);
      params.set("mode", settings.mode);
      location.search = params.toString();
    };

    document.getElementById("simExplain").onclick = () => {
      if (settings.mode === "ru") ui('.seg button[data-m="bi"]')?.click(); // original must be visible to select it
      setTimeout(() => {
        const p = [...document.querySelectorAll(".StyledAccordionDetailsMain-demo p")].find((x) => x.textContent.includes("port scan") && !x.classList.contains("thmru-tr"));
        const b = p?.querySelector("b");
        if (!b) return;
        const r = document.createRange();
        r.selectNodeContents(b);
        getSelection().removeAllRanges();
        getSelection().addRange(r);
        onMessage.forEach((f) => f({ type: "explainSelection", text: "port scan" }));
      }, 300);
    };

    document.getElementById("simChat").onclick = () => {
      ui(".chatbtn")?.click();
      setTimeout(() => {
        const ta = ui("textarea");
        if (!ta) return;
        ta.value = CHAT.q;
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      }, 400);
    };

    document.getElementById("simDict").onclick = () => ui(".dict")?.click();
  });
})();
