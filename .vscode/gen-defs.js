// 1) decks 폴더와 data/decks.json 을 맞춘다. 새 이미지는 항목 추가, 지운 이미지는 항목 삭제
//    (조합에서 사용 중인 덱은 지우지 않음).
//    파일 이름 규칙: 전투원ID-덱이름.png  (예: yuki-inspire.png → 덱 코드 yuki-inspire, 주인 yuki)
// 2) data/combatants.json, data/decks.json 을 읽어
//    .vscode 안 스키마들의 전투원 ID(charId)·덱 코드(deckCode) 목록을 갱신한다.
//   한 번 실행: node .vscode/gen-defs.js
//   계속 감시: node .vscode/gen-defs.js --watch
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");
const DECK_IMG = path.join(ROOT, "decks");
const SCHEMA_DIR = __dirname;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}
function listOf(j, key) {
  return Array.isArray(j) ? j : (j && Array.isArray(j[key]) ? j[key] : []);
}
function indentOf(text) {
  const m = text.match(/\n([ \t]+)\S/);
  return m ? m[1] : 2;
}

/* teams.json 에서 사용 중인 덱 코드 (읽기 실패 시 null) */
function usedDeckCodes() {
  try {
    const teams = listOf(readJson(path.join(DATA, "teams.json")), "teams");
    return new Set(teams.flatMap(t => (t.slots || []).map(s => s.deck)).filter(Boolean));
  } catch (e) { return null; }
}

/* decks 폴더와 decks.json 맞추기: 새 이미지는 항목 추가, 사라진 이미지는 항목 삭제 */
function syncDeckImages(ids) {
  const file = path.join(DATA, "decks.json");
  let text, decks;
  try { text = fs.readFileSync(file, "utf8"); decks = JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch (e) { console.log("[건너뜀] decks.json 읽기 실패:", e.message); return; }
  if (!Array.isArray(decks)) { console.log("[건너뜀] decks.json 이 배열 형식이 아님"); return; }
  if (!fs.existsSync(DECK_IMG)) return;

  const files = fs.readdirSync(DECK_IMG).filter(n => /\.(png|jpe?g|webp)$/i.test(n)).sort();
  const present = new Set(files.map(n => "decks/" + n));
  const logs = [];

  // 1) 이미지가 사라진 항목
  const gone = decks.filter(k => k.image && k.image.startsWith("decks/") && !present.has(k.image));
  const removed = [];
  if (gone.length) {
    const inUse = usedDeckCodes();
    if (!inUse) {
      logs.push("[보류] teams.json 을 읽지 못해 삭제를 미룸: " + gone.map(k => k.code).join(", "));
    } else {
      for (const k of gone) {
        if (inUse.has(k.code)) {
          logs.push(`[유지] ${k.code} — 이미지가 없지만 조합에서 사용 중이라 남겨 둠 (조합 화면에 빈 이미지로 표시됨)`);
        } else {
          removed.push(k);
        }
      }
    }
  }

  // 2) decks.json 에 없는 새 이미지
  const removedSet = new Set(removed);
  const keep = decks.filter(k => !removedSet.has(k));
  const used = new Set(keep.map(k => k.image));
  const codes = new Set(keep.map(k => k.code));
  const added = [];
  for (const name of files) {
    const image = "decks/" + name;
    if (used.has(image)) continue;
    let code = name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!code) continue;
    while (codes.has(code)) code += "-2";
    // 파일 이름 앞부분과 일치하는 전투원 ID 중 가장 긴 것
    const char = ids.filter(id => code === id || code.startsWith(id + "-")).sort((a, b) => b.length - a.length)[0] || "";
    const entry = { code, char, name: code, image, note: "" };
    keep.push(entry); codes.add(code); added.push(entry);
  }

  // 3) 한 번에 1개 삭제 + 1개 추가 = 이름 바꾸기로 보고, 직접 쓴 덱 이름·설명을 옮김
  if (removed.length === 1 && added.length === 1) {
    const [from] = removed, to = added[0];
    if (from.name && from.name !== from.code) to.name = from.name;
    if (from.note) to.note = from.note;
    logs.push(`[이름 변경] ${from.image} → ${to.image} (덱 코드 ${from.code} → ${to.code}, 이름·설명 유지)`);
  } else {
    removed.forEach(k => logs.push("[덱 삭제] " + k.code + "  복구용: " + JSON.stringify(k)));
    added.forEach(k => logs.push("[덱 추가] " + k.code + (k.char ? "" : " (전투원 ID를 찾지 못함 — char 직접 입력 필요)")));
  }

  if (removed.length || added.length) fs.writeFileSync(file, JSON.stringify(keep, null, indentOf(text)) + "\n", "utf8");
  logs.forEach(l => console.log(l));
}

function update() {
  let ids;
  try { ids = listOf(readJson(path.join(DATA, "combatants.json")), "combatants").map(c => c.id).filter(Boolean); }
  catch (e) { console.log("[건너뜀] combatants.json 읽기 실패 (편집 중이거나 JSON 오류):", e.message); return; }

  syncDeckImages(ids);

  let codes;
  try { codes = listOf(readJson(path.join(DATA, "decks.json")), "decks").map(k => k.code).filter(Boolean); }
  catch (e) { console.log("[건너뜀] decks.json 읽기 실패 (편집 중이거나 JSON 오류):", e.message); return; }

  for (const name of fs.readdirSync(SCHEMA_DIR)) {
    if (!name.endsWith(".schema.json")) continue;
    const file = path.join(SCHEMA_DIR, name);
    let text, schema;
    try { text = fs.readFileSync(file, "utf8"); schema = JSON.parse(text); }
    catch (e) { console.log("[건너뜀]", name, "읽기 실패:", e.message); continue; }
    const defs = schema.definitions;
    if (!defs || (!defs.charId && !defs.deckCode)) continue;
    if (defs.charId) defs.charId.enum = [...new Set(ids)];
    if (defs.deckCode) defs.deckCode.enum = [...new Set(codes)];
    const out = JSON.stringify(schema, null, indentOf(text)) + "\n";
    if (out !== text) {
      fs.writeFileSync(file, out, "utf8");
      console.log(`[갱신] ${name} — 전투원 ${ids.length}명, 덱 ${codes.length}개`);
    }
  }
}

update();

if (process.argv.includes("--watch")) {
  let timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(update, 500); };
  fs.watch(DATA, (event, filename) => {
    if (filename && !/^(combatants|decks)\.json$/.test(filename)) return;
    later();
  });
  if (fs.existsSync(DECK_IMG)) fs.watch(DECK_IMG, later);
  console.log("data·decks 폴더 감시 중… (종료: Ctrl+C)");
}