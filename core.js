export const FORMAT = 'svoya-studio';
export const VERSION = 1;
export const MAX_FILE = 80 * 1024 * 1024;
export const uid = () => globalThis.crypto.randomUUID();
export const clone = value => structuredClone(value);
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const isReady = q => Boolean((q.text.trim() || q.media) && q.answer.trim());

export function question(value = 100) {
  return {id: uid(), value, text: '', answer: '', notes: '', media: null};
}
export function round(name = 'Раунд 1', columns = 5, rows = 5) {
  return {id: uid(), name, categories: Array.from({length: columns}, (_, i) => ({
    id: uid(), name: `Тема ${i + 1}`, questions: Array.from({length: rows}, (_, j) => question((j + 1) * 100))
  }))};
}
export function createProject(title = 'Новая игра') {
  return {id: uid(), title, description: '', updatedAt: new Date().toISOString(), timer: 30,
    teams: ['Команда 1', 'Команда 2', 'Команда 3'], rounds: [round()]};
}
export function stats(project) {
  const questions = project.rounds.flatMap(r => r.categories.flatMap(c => c.questions));
  return {total: questions.length, ready: questions.filter(isReady).length};
}
export function findQuestion(project, id) {
  for (const r of project.rounds) for (const c of r.categories) {
    const q = c.questions.find(q => q.id === id);
    if (q) return {round: r, category: c, question: q};
  }
  return null;
}

function text(value, max, label) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Некорректное поле «${label}».`);
  return value;
}
function int(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Некорректное поле «${label}».`);
  return value;
}
function array(value, min, max, label) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`Некорректное число элементов: ${label}.`);
  return value;
}
export function validateMedia(value) {
  if (value == null) return null;
  if (!['image', 'audio', 'video'].includes(value.kind)) throw new Error('Неизвестный тип вложения.');
  const src = text(value.src, MAX_FILE, 'вложение');
  const dataPatterns = {image: /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/, audio: /^data:audio\/(mpeg|mp3|wav|x-wav|ogg|webm|mp4|aac);base64,[A-Za-z0-9+/=]+$/, video: /^data:video\/(mp4|webm|ogg|quicktime);base64,[A-Za-z0-9+/=]+$/};
  if (!dataPatterns[value.kind].test(src)) throw new Error('В проекте есть неподдерживаемое вложение. Используйте PNG, JPG, WebP, GIF, MP3, WAV, OGG, M4A, MP4 или WebM.');
  return {kind: value.kind, src, name: text(value.name ?? 'Вложение', 255, 'имя файла')};
}
export function validateProject(input, newIdentity = false) {
  if (!input || typeof input !== 'object') throw new Error('Файл не содержит проекта.');
  const used = new Set();
  const id = value => {
    const clean = typeof value === 'string' && /^[\w-]{1,80}$/.test(value) && !used.has(value) ? value : uid();
    used.add(clean); return clean;
  };
  const project = {id: newIdentity ? uid() : id(input.id), title: text(input.title, 160, 'название'),
    description: text(input.description ?? '', 2000, 'описание'), updatedAt: new Date().toISOString(),
    timer: int(input.timer ?? 30, 0, 600, 'таймер'),
    teams: array(input.teams, 1, 12, 'команды').map(t => text(t, 80, 'команда')),
    rounds: array(input.rounds, 1, 12, 'раунды').map(r => ({id: id(r.id), name: text(r.name, 100, 'раунд'),
      categories: array(r.categories, 1, 10, 'темы').map(c => ({id: id(c.id), name: text(c.name, 120, 'тема'),
        questions: array(c.questions, 1, 10, 'вопросы').map(q => ({id: id(q.id), value: int(q.value, 0, 100000, 'стоимость'),
          text: text(q.text, 10000, 'вопрос'), answer: text(q.answer, 10000, 'ответ'), notes: text(q.notes ?? '', 6000, 'заметки'), media: validateMedia(q.media)}))
      }))}))};
  for (const r of project.rounds) if (!r.categories.every(c => c.questions.length === r.categories[0].questions.length)) throw new Error('В темах одного раунда должно быть одинаковое количество вопросов.');
  return project;
}
export function exportProject(project) {
  return JSON.stringify({format: FORMAT, version: VERSION, project}, null, 2);
}
export function importProject(source) {
  if (source.length > MAX_FILE) throw new Error('Файл проекта слишком большой. Максимум — 80 МБ.');
  let data;
  try { data = JSON.parse(source); } catch { throw new Error('Не удалось прочитать JSON. Выберите файл проекта «Своя».'); }
  if (data?.format !== FORMAT || data.version !== VERSION) throw new Error('Это не поддерживаемый файл проекта «Своя».');
  return validateProject(data.project, true);
}

export function createGame(project) {
  return {id: uid(), projectId: project.id, roundId: project.rounds[0].id, questionId: null, used: [],
    revealed: false, blank: false, finished: false, timer: {remaining: project.timer, endsAt: null},
    teams: project.teams.map(name => ({id: uid(), name, score: 0})), history: []};
}
export function secondsLeft(game, now = Date.now()) {
  return game.timer.endsAt ? Math.max(0, Math.ceil((game.timer.endsAt - now) / 1000)) : game.timer.remaining;
}
export function openQuestion(project, game, id) {
  const found = findQuestion(project, id);
  if (!found || !isReady(found.question) || game.used.includes(id)) return false;
  game.roundId = found.round.id; game.questionId = id; game.revealed = false; game.blank = false;
  game.timer = {remaining: project.timer, endsAt: null}; return true;
}
export function closeQuestion(game, markUsed = true) {
  if (markUsed && game.questionId && !game.used.includes(game.questionId)) game.used.push(game.questionId);
  game.questionId = null; game.revealed = false; game.timer.endsAt = null;
}
export function changeScore(game, teamId, delta) {
  if (!Number.isFinite(delta) || !Number.isInteger(delta) || Math.abs(delta) > 1000000) throw new Error('Укажите целое изменение счёта от −1 000 000 до 1 000 000.');
  const team = game.teams.find(t => t.id === teamId);
  if (!team) throw new Error('Команда не найдена.');
  game.history.push({teamId, previous: team.score});
  if (game.history.length > 200) game.history.shift();
  team.score += delta;
}
export function undoScore(game) {
  const item = game.history.pop();
  if (item) { const team = game.teams.find(t => t.id === item.teamId); if (team) team.score = item.previous; }
}

// Only this allowlisted view crosses to the audience window. No project, notes or hidden answers.
export function publicState(project, game) {
  const r = project.rounds.find(r => r.id === game.roundId) || project.rounds[0];
  const found = game.questionId ? findQuestion(project, game.questionId) : null;
  const state = {title: project.title, round: r.name, blank: game.blank, finished: game.finished,
    teams: game.teams.map(t => ({name: t.name, score: t.score})),
    board: r.categories.map(c => ({name: c.name, questions: c.questions.map(q => ({value: q.value, used: game.used.includes(q.id), ready: isReady(q)}))})),
    timer: {...game.timer, enabled: project.timer > 0}, question: null};
  if (found) state.question = {id: found.question.id, category: found.category.name, value: found.question.value, text: found.question.text,
    media: found.question.media ? {kind: found.question.media.kind, src: found.question.media.src} : null, revealed: game.revealed,
    ...(game.revealed ? {answer: found.question.answer} : {})};
  return state;
}

export function demoProject() {
  const p = createProject('Вечер хороших вопросов');
  p.description = 'Разминка для любопытных. Четыре темы, двадцать вопросов и одна отличная компания.';
  const data = [
    ['Вокруг света', ['Столица Китая?', 'Пекин'], ['В какой стране находится Колизей?', 'Италия'], ['Какой океан самый большой по площади?', 'Тихий океан'], ['Как называется столица Австралии?', 'Канберра'], ['Какая страна полностью окружает Лесото?', 'Южно-Африканская Республика (ЮАР)']],
    ['Наука рядом', ['Химическая формула воды?', 'H₂O'], ['Какая планета ближе всего к Солнцу?', 'Меркурий'], ['Какой газ растения поглощают при фотосинтезе?', 'Углекислый газ (CO₂)'], ['Какой химический элемент имеет символ Fe?', 'Железо'], ['Как называется переход вещества из твёрдого состояния сразу в газообразное?', 'Сублимация (возгонка)']],
    ['Книги и кино', ['Кто написал «Евгения Онегина»?', 'Александр Сергеевич Пушкин'], ['Как зовут волшебника со шрамом в виде молнии?', 'Гарри Поттер'], ['Из какого произведения фраза «Рукописи не горят»?', '«Мастер и Маргарита», Михаил Булгаков'], ['Как зовут режиссёра фильма «Начало» (2010)?', 'Кристофер Нолан'], ['Кто написал роман «451 градус по Фаренгейту»?', 'Рэй Брэдбери']],
    ['Логика', ['Сколько месяцев в году содержат хотя бы 28 дней?', '12 — все месяцы'], ['Что тяжелее: килограмм железа или килограмм ваты?', 'Масса одинакова: один килограмм'], ['В семье пять сыновей. У каждого одна сестра. Сколько всего детей?', 'Шесть: пять братьев и их общая сестра'], ['Продолжите ряд: 1, 1, 2, 3, 5, 8, …', '13 — каждое следующее число равно сумме двух предыдущих'], ['Две монеты дают 15 рублей. Одна из них не пятирублёвая. Какие это монеты?', '10 и 5 рублей. Не пятирублёвая — монета в 10 рублей']]
  ];
  p.rounds = [round('Разминка', 4)];
  p.rounds[0].categories.forEach((c, i) => { c.name = data[i][0]; c.questions.forEach((q, j) => { [q.text, q.answer] = data[i][j + 1]; }); });
  return p;
}
