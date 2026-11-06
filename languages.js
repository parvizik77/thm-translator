// Languages the extension can translate into: [code, English name, native name].
// Covers the most widely spoken languages and the main languages of the largest countries.
// Shared by the service worker (importScripts) and the options page (<script>).
var LANGUAGES = [
  ["ru", "Russian", "Русский"],
  ["uk", "Ukrainian", "Українська"],
  ["es", "Spanish", "Español"],
  ["pt-BR", "Portuguese (Brazil)", "Português (Brasil)"],
  ["pt-PT", "Portuguese (Portugal)", "Português (Portugal)"],
  ["fr", "French", "Français"],
  ["de", "German", "Deutsch"],
  ["it", "Italian", "Italiano"],
  ["nl", "Dutch", "Nederlands"],
  ["pl", "Polish", "Polski"],
  ["cs", "Czech", "Čeština"],
  ["ro", "Romanian", "Română"],
  ["hu", "Hungarian", "Magyar"],
  ["el", "Greek", "Ελληνικά"],
  ["sv", "Swedish", "Svenska"],
  ["tr", "Turkish", "Türkçe"],
  ["ar", "Arabic", "العربية"],
  ["fa", "Persian", "فارسی"],
  ["he", "Hebrew", "עברית"],
  ["ur", "Urdu", "اردو"],
  ["hi", "Hindi", "हिन्दी"],
  ["bn", "Bengali", "বাংলা"],
  ["mr", "Marathi", "मराठी"],
  ["ta", "Tamil", "தமிழ்"],
  ["te", "Telugu", "తెలుగు"],
  ["zh-CN", "Chinese (Simplified)", "简体中文"],
  ["zh-TW", "Chinese (Traditional)", "繁體中文"],
  ["ja", "Japanese", "日本語"],
  ["ko", "Korean", "한국어"],
  ["vi", "Vietnamese", "Tiếng Việt"],
  ["th", "Thai", "ไทย"],
  ["id", "Indonesian", "Bahasa Indonesia"],
  ["ms", "Malay", "Bahasa Melayu"],
  ["fil", "Filipino", "Filipino"],
  ["my", "Burmese", "မြန်မာ"],
  ["sw", "Swahili", "Kiswahili"],
  ["am", "Amharic", "አማርኛ"],
  ["ha", "Hausa", "Hausa"],
  ["yo", "Yoruba", "Yorùbá"],
  ["kk", "Kazakh", "Қазақ тілі"],
  ["uz", "Uzbek", "Oʻzbekcha"],
  ["az", "Azerbaijani", "Azərbaycanca"],
  ["tg", "Tajik", "Тоҷикӣ"],
  ["ka", "Georgian", "ქართული"],
  ["hy", "Armenian", "Հայերեն"],
];

var RTL_LANGUAGES = new Set(["ar", "fa", "he", "ur"]);

function languageInfo(code) {
  const row = LANGUAGES.find((l) => l[0] === code) || LANGUAGES[0];
  return { code: row[0], name: row[1], native: row[2], rtl: RTL_LANGUAGES.has(row[0]), short: row[0].split("-")[0].toUpperCase() };
}
