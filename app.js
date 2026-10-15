import {uid, clone, escapeHTML as e, createProject, demoProject, round, question, stats, isReady,
  findQuestion, validateProject, validateMedia, exportProject, importProject, MAX_FILE,
  createGame, secondsLeft, openQuestion, closeQuestion, changeScore, undoScore, publicState} from './core.js';
import * as db from './storage.js';

const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const importInput = document.querySelector('#import-file');
let projects = [], project = null, selectedRound = null, view = 'library';
let game = null, playProject = null, screenWindow = null, channel = null;
let saveTimer, saveChain = Promise.resolve(), pendingSaves = 0, unsaved = false, saveFailed = false;
let changeRevision = 0;
let screenSeenAt = 0, toastTimer, draftQuestion = null, lastQuestionFocus = null;
const savedGames = new Map();
const button = (action, label, style = '', attrs = '') => `<button type="button" class="btn ${style}" data-action="${action}" ${attrs}>${label}</button>`;
const icon = '<span class="brand-icon" aria-hidden="true">✳</span>';

function toast(message, error = false) {
  const el = document.querySelector('#toast'); el.textContent = message; el.className = `visible ${error ? 'error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => {el.className = '';}, 6500);
}
function shell(content) {
  return `<aside class="sidebar"><a class="brand" href="#" data-action="library">${icon}<span>своя<small>студия викторин</small></span></a>
    <nav aria-label="Навигация"><button class="nav-item ${view === 'library' ? 'active' : ''}" data-action="library"><span>▦</span> Мои игры <span class="count">${projects.length}</span></button>
    <button class="nav-item" data-action="new"><span>＋</span> Создать игру</button><button class="nav-item" data-action="import"><span>↥</span> Открыть файл</button></nav>
    <div class="sidebar-bottom"><div class="local-note"><span class="status-dot"></span> Всё под рукой<p>Проекты сохраняются в этом браузере. Скачивай файл для резервной копии.</p></div>
    <button class="nav-item" data-action="help"><span>?</span> Как провести игру</button><small>Своя студия · без регистрации</small></div></aside>
    <div class="workspace"><main id="main" tabindex="-1">${content}</main></div>`;
}
function getRound() {return project.rounds.find(r => r.id === selectedRound) || project.rounds[0];}
function getStatsMarkup(p) {
  const s = stats(p); return `<span>${p.rounds.length} ${p.rounds.length === 1 ? 'раунд' : p.rounds.length < 5 ? 'раунда' : 'раундов'}</span><span>${s.ready}/${s.total} вопросов готовы</span>`;
}
function libraryHTML() {
  return `<header class="page-header"><div><div class="eyebrow">ТВОЯ КОМПАНИЯ. ТВОИ ПРАВИЛА.</div><h1>Мои игры<span class="title-dot">.</span></h1><p class="muted">Придумай вопросы. Собери команды. Устрой свою игру.</p></div>${button('new', '＋ Создать игру', 'primary')}</header>
    <section class="intro-strip"><div><span class="small-label">ОДИН НОУТБУК — ДВА ЭКРАНА</span><h2>Вопрос — всем.<br>Ответ — только тебе.</h2><p>Пульт остаётся у ведущего, а таблица и вопросы<br class="desktop-only"> открываются в отдельном окне для проектора.</p>${button('help','Как это работает ↗','text-btn')}</div><div class="intro-visual" aria-hidden="true"><div class="mini-host"><span>ПУЛЬТ ВЕДУЩЕГО</span><b>Какая планета ближе к Солнцу?</b><em>Ответ: Меркурий</em></div><div class="mini-projector"><span>ЭКРАН ЗРИТЕЛЕЙ</span><div>100 <i>200</i> 300<br>200 <i>300</i> 400<br>300 <i>400</i> 500</div></div></div></section>
    <div class="section-heading"><h2>Твои проекты <span>${projects.length}</span></h2>${button('import','↥ Открыть из файла','text-btn')}</div>
    <section class="projects" aria-label="Проекты">${projects.map(p => `<article class="project-card"><div class="card-preview" aria-hidden="true"><div class="preview-label">${e(p.rounds[0].name)}</div><div class="tiny-board">${p.rounds[0].categories.slice(0,5).map(c => `<div><b>${e(c.name)}</b>${c.questions.slice(0,3).map(q => `<span>${q.value}</span>`).join('')}</div>`).join('')}</div></div><div class="card-body"><h3>${e(p.title || 'Без названия')}</h3><div class="card-meta">${getStatsMarkup(p)}</div><p class="card-description">${e(p.description || 'Добавь свои темы и вопросы — и можно играть.')}</p><div class="card-actions">${button('edit','Редактировать ↗','',`data-id="${p.id}"`)}${button('start','▶ Играть','primary',`data-id="${p.id}"`)}</div><div class="card-foot"><span>Изменено ${new Intl.DateTimeFormat('ru',{day:'numeric',month:'short'}).format(new Date(p.updatedAt))}</span><div>${button('duplicate','Копия','small text-btn',`data-id="${p.id}"`)}${button('delete','Удалить','small text-btn danger-text',`data-id="${p.id}"`)}</div></div></div></article>`).join('')}
    <button class="new-card" data-action="new"><span>＋</span><b>Новая история</b><small>Собери свою викторину с нуля</small></button></section>`;
}
function editorHTML() {
  const r = getRound(), s = stats(project);
  return `<header class="editor-header"><div><button class="back-link" data-action="library">Мои игры /</button><div class="editor-title"><input aria-label="Название игры" data-field="title" maxlength="160" value="${e(project.title)}"><span id="save-status" role="status" class="save-status">${unsaved ? 'Сохраняем…' : saveFailed ? 'Не сохранено' : '✓ Сохранено'}</span></div></div><div class="actions">${button('export','↓ Скачать проект')}${button('start','▶ Провести игру','primary',`data-id="${project.id}"`)}</div></header>
    <div class="editor-info"><span class="pill">КОНСТРУКТОР</span><span>Нажми на стоимость, чтобы добавить вопрос и ответ.</span></div>
    <section class="board-section"><div class="round-toolbar"><div class="round-tabs" role="tablist" aria-label="Раунды">${project.rounds.map((r,i)=> `<button role="tab" aria-selected="${r.id===selectedRound}" class="round-tab ${r.id===selectedRound?'active':''}" data-action="round" data-id="${r.id}"><span>${String(i+1).padStart(2,'0')}</span> ${e(r.name)}</button>`).join('')}</div>${button('add-round','＋ Раунд','text-btn',project.rounds.length>=12?'disabled':'')}</div>
    <div class="board-controls"><div class="round-name"><input aria-label="Название раунда" data-field="round-name" maxlength="100" value="${e(r.name)}">${button('delete-round','Удалить раунд','small text-btn danger-text',project.rounds.length===1?'disabled':'')}</div><div class="actions">${button('add-category','＋ Тема','small',r.categories.length>=10?'disabled':'')}${button('add-row','＋ Строка','small',r.categories[0].questions.length>=10?'disabled':'')}${button('delete-row','− Строка','small',r.categories[0].questions.length<=1?'disabled':'')}</div></div>
    <div class="board-scroll"><table class="editor-board"><thead><tr>${r.categories.map(c=>`<th scope="col"><div class="category-title"><input aria-label="Название темы ${e(c.name)}" data-category="${c.id}" maxlength="120" value="${e(c.name)}"><button class="icon-btn" data-action="delete-category" data-id="${c.id}" aria-label="Удалить тему ${e(c.name)}" ${r.categories.length===1?'disabled':''}>×</button></div></th>`).join('')}</tr></thead><tbody>${r.categories[0].questions.map((_,i)=>`<tr>${r.categories.map(c=>{const q=c.questions[i];return `<td><button class="question-cell ${isReady(q)?'ready':''}" data-action="question" data-id="${q.id}" aria-label="${e(c.name)}, ${q.value} баллов, ${isReady(q)?'готов':'не заполнен'}"><span class="cell-top"><span class="cell-value">${q.value}</span><span class="cell-mark" aria-hidden="true">${isReady(q)?'✓':'＋'}</span></span><span class="cell-preview">${e(q.text || (q.media?'Вопрос с вложением':'Добавить вопрос'))}</span></button></td>`;}).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="board-footer"><span><span class="ready-marker">✓</span> Готовый вопрос <span class="empty-marker">＋</span> Ещё не заполнен</span><span id="ready-count">${s.ready} из ${s.total} готовы</span></div></section>
    <div class="settings-grid"><section class="settings-panel"><div class="section-heading"><h2>Перед стартом</h2><span class="small-label">НАСТРОЙКИ</span></div><label>Описание игры<textarea data-field="description" maxlength="2000" rows="2" placeholder="Для кого эта игра и о чём она?">${e(project.description)}</textarea></label><div class="inline-setting"><label for="timer-setting">Время на вопрос<small>0 — играть без таймера</small></label><div><input id="timer-setting" type="number" min="0" max="600" step="1" data-field="timer" value="${project.timer}"><span>сек.</span></div></div></section>
    <section class="settings-panel"><div class="section-heading"><h2>Команды</h2><span class="small-label">ДО 12 КОМАНД</span></div><div class="teams-editor">${project.teams.map((name,i)=>`<div class="team-edit"><span class="team-index">${String(i+1).padStart(2,'0')}</span><input aria-label="Название команды ${i+1}" maxlength="80" data-team="${i}" value="${e(name)}"><button class="icon-btn" data-action="delete-team" data-index="${i}" aria-label="Удалить команду ${i+1}" ${project.teams.length===1?'disabled':''}>×</button></div>`).join('')}</div>${button('add-team','＋ Добавить команду','text-btn small',project.teams.length>=12?'disabled':'')}</section></div>
    <div class="bottom-note">↧ Скачай проект перед мероприятием: файл сохраняет вопросы, ответы и все вложения.</div>`;
}
function gameBoardHTML() {
  const r = playProject.rounds.find(r=>r.id===game.roundId) || playProject.rounds[0];
  return `<div class="board-scroll"><table class="play-board"><thead><tr>${r.categories.map(c=>`<th scope="col">${e(c.name)}</th>`).join('')}</tr></thead><tbody>${r.categories[0].questions.map((_,i)=>`<tr>${r.categories.map(c=>{const q=c.questions[i],used=game.used.includes(q.id),ready=isReady(q);return `<td><button data-action="open-question" data-id="${q.id}" ${used||!ready?'disabled':''} aria-label="${e(c.name)}, ${q.value} баллов${used?', сыгран':!ready?', не заполнен':''}">${used?'—':ready?q.value:'·'}</button></td>`;}).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function hostQuestionHTML() {
  const found = findQuestion(playProject, game.questionId);
  if (!found) return '';
  const q = found.question;
  return `<section class="host-question"><div class="question-meta"><span>${e(found.category.name)} / ${q.value} баллов</span><span class="pill">ВОПРОС НА ЭКРАНЕ</span></div><h2>${e(q.text || 'Вопрос с вложением')}</h2>${q.media?`<div class="host-media">${mediaHTML(q.media)}</div>`:''}
    <div class="private-answer"><span class="small-label">ТОЛЬКО ВЕДУЩЕМУ · ПРАВИЛЬНЫЙ ОТВЕТ</span><p>${e(q.answer)}</p>${q.notes?`<div class="host-notes">${e(q.notes)}</div>`:''}</div>
    <div class="question-buttons">${button('reveal',game.revealed?'Скрыть ответ у зрителей':'Показать ответ зрителям',game.revealed?'':'primary')}${button('close-question','✓ Завершить вопрос')}${button('cancel-question','Вернуть без отметки','text-btn')}</div></section>`;
}
function gameHTML() {
  const found = game.questionId?findQuestion(playProject,game.questionId):null;
  const value = found?.question.value ?? 100;
  return `<header class="page-header game-header"><div><div class="eyebrow">ПУЛЬТ ВЕДУЩЕГО</div><h1>${e(playProject.title)}</h1><p class="muted">Ответы и управление видны только в этом окне.</p></div><div class="actions">${button('exit-game','В редактор')}${button('screen','↗ Открыть экран зрителей','primary')}</div></header>
    <div class="screen-guide"><span class="guide-icon">▣</span><div><b>Проектор работает как второй экран</b><p>Включи режим «Расширить» на компьютере, перенеси отдельное окно на проектор и нажми в нём «На весь экран». При демонстрации в звонке выбери только окно зрителей.</p></div><span id="screen-status" class="pill">${Date.now()-screenSeenAt<6000?'Экран подключён':'Экран не открыт'}</span></div>
    <div class="game-toolbar"><div class="round-tabs">${playProject.rounds.map(r=>`<button class="round-tab ${r.id===game.roundId?'active':''}" data-action="game-round" data-id="${r.id}" ${game.questionId?'disabled':''}>${e(r.name)}</button>`).join('')}</div><div class="actions">${button('blank',game.blank?'Вернуть изображение':'Скрыть экран','small')}${button('finish',game.finished?'Продолжить игру':'Итоги','small')}${button('restart','Начать заново','small danger-text')}</div></div>
    ${game.finished?`<section class="results-host"><span class="eyebrow">ФИНАЛ</span><h2>Игра завершена!</h2><p>На экране зрителей — итоговый рейтинг. Счёт можно поправить ниже.</p></section>`:game.questionId?hostQuestionHTML():gameBoardHTML()}
    <div class="host-bottom"><section class="scoreboard-panel"><div class="section-heading"><h2>Счёт команд</h2>${button('undo','↶ Отменить начисление','small text-btn',!game.history.length?'disabled':'')}</div><div class="score-teams">${game.teams.map(t=>`<div class="score-team"><b>${e(t.name)}</b><strong>${t.score}</strong><div>${button('score',`−${value}`,'small',`data-id="${t.id}" data-delta="${-value}" aria-label="Вычесть ${value} у ${e(t.name)}"`)}${button('score',`+${value}`,'small score-plus',`data-id="${t.id}" data-delta="${value}" aria-label="Добавить ${value} команде ${e(t.name)}"`)}${button('manual-score','±','small',`data-id="${t.id}" aria-label="Изменить счёт ${e(t.name)}"`)}</div></div>`).join('')}</div><small class="muted">Начисление баллов не закрывает вопрос: можно принять ответы нескольких команд.</small></section>
    <section class="timer-panel"><span class="small-label">ТАЙМЕР ВОПРОСА</span><strong id="timer-value">${playProject.timer?secondsLeft(game):'∞'}</strong><div>${button('timer',game.timer.endsAt?'Пауза':'▶ Старт','small',!game.questionId||!playProject.timer?'disabled':'')}${button('reset-timer','↺','small',`aria-label="Сбросить таймер" ${!game.questionId?'disabled':''}`)}</div></section></div><p class="bottom-note">Прогресс игры сохраняется на этом устройстве. Пробел — таймер, Esc — пауза экрана.</p>`;
}
function mediaHTML(media) {
  if (media.kind==='image') return `<img src="${e(media.src)}" alt="Иллюстрация к вопросу">`;
  return `<${media.kind} src="${e(media.src)}" controls preload="metadata" ${media.kind==='video'?'playsinline':''}></${media.kind}>`;
}
function render(focusMain = false) {
  app.innerHTML = shell(view==='library'?libraryHTML():view==='editor'?editorHTML():gameHTML());
  if (focusMain) document.querySelector('#main').focus({preventScroll:true});
}
function updateSaveStatus() {
  const status=document.querySelector('#save-status');
  if(status) {status.textContent=saveFailed?'⚠ Не сохранено':unsaved||pendingSaves?'Сохраняем…':'✓ Сохранено';status.classList.toggle('failure',saveFailed);}
  const s=project&&stats(project), count=document.querySelector('#ready-count'); if(count&&s) count.textContent=`${s.ready} из ${s.total} готовы`;
}
function markChanged() {
  project.updatedAt=new Date().toISOString();changeRevision++;unsaved=true;updateSaveStatus();clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>queueSave(),350);
}
function queueSave() {
  clearTimeout(saveTimer); if(!project||!unsaved) return saveChain;
  const snapshot=clone(project),revision=changeRevision;unsaved=false;pendingSaves++;updateSaveStatus();
  saveChain=saveChain.catch(()=>{}).then(()=>db.saveProject(snapshot)).then(()=>{saveFailed=false;if(project?.id===snapshot.id&&changeRevision===revision)unsaved=false;},err=>{saveFailed=true;unsaved=true;toast(`Не удалось сохранить в браузере. Скачай проект: ${err.message}`,true);}).finally(()=>{pendingSaves--;updateSaveStatus();});
  return saveChain;
}
async function chooseProject(id) {
  await queueSave();if(unsaved && !await confirmDialog('Проект не сохранён','Сначала скачай текущий проект. Всё равно перейти к другой игре?','Перейти')) return;
  project=projects.find(p=>p.id===id);if(!project) return;
  selectedRound=project.rounds[0].id;view='editor';unsaved=false;saveFailed=false;render(true);
}
function showModal(html, focusSelector) {
  modal.innerHTML=html;const title=modal.querySelector('h2');if(title){title.id='modal-title';modal.setAttribute('aria-labelledby','modal-title');}modal.showModal();
  (focusSelector?modal.querySelector(focusSelector):modal.querySelector('input,button'))?.focus();
}
function confirmDialog(title,message,label='Подтвердить',cancelLabel='Отмена') {
  return new Promise(resolve=>{
    showModal(`<div class="dialog-content"><div class="dialog-top"><h2>${e(title)}</h2></div><p>${e(message)}</p><div class="dialog-actions"><button type="button" class="btn" data-confirm="no">${e(cancelLabel)}</button><button type="button" class="btn primary" data-confirm="yes">${e(label)}</button></div></div>`,'[data-confirm="no"]');
    const handler=event=>{const target=event.target.closest('[data-confirm]');if(target){cleanup();modal.close();resolve(target.dataset.confirm==='yes');}};
    const cancel=()=>{cleanup();resolve(null);};
    const cleanup=()=>{modal.removeEventListener('click',handler);modal.removeEventListener('cancel',cancel);};
    modal.addEventListener('click',handler);modal.addEventListener('cancel',cancel,{once:true});
  });
}
function openQuestionEditor(id) {
  const found=findQuestion(project,id);if(!found)return;draftQuestion=found.question;lastQuestionFocus=id;
  const q=draftQuestion;
  showModal(`<div class="dialog-content question-editor"><div class="dialog-top"><div><span class="eyebrow">${e(found.category.name)}</span><h2>Редактор вопроса</h2></div>${button('close-modal','×','icon-btn', 'aria-label="Закрыть редактор"')}</div>
    <div class="question-editor-body"><div class="question-fields"><label>Стоимость, баллы<input type="number" min="0" max="100000" step="1" data-qfield="value" value="${q.value}"></label><label>Вопрос<textarea data-qfield="text" maxlength="10000" rows="4" placeholder="Что увидят участники?">${e(q.text)}</textarea></label><label class="answer-field">Правильный ответ <span>Только ведущему</span><textarea data-qfield="answer" maxlength="10000" rows="3" placeholder="Точный ответ и допустимые варианты">${e(q.answer)}</textarea></label><label>Заметки ведущего<textarea data-qfield="notes" maxlength="6000" rows="2" placeholder="Подсказки, пояснения, источник…">${e(q.notes)}</textarea></label></div>
    <aside class="media-panel"><span class="small-label">ВЛОЖЕНИЕ К ВОПРОСУ</span><div id="media-preview">${q.media?mediaHTML(q.media):'<div class="upload-empty"><span>↥</span><b>Покажи больше</b><p>Картинка, музыка или видео<br>для твоего вопроса</p></div>'}</div><label class="btn file-label">${q.media?'Заменить файл':'＋ Добавить файл'}<input id="media-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg,audio/mp4,audio/aac,video/mp4,video/webm,video/ogg,video/quicktime" hidden></label>${button('remove-media','Удалить вложение','small text-btn danger-text',q.media?'':'disabled')}<p>Фото до 8 МБ, аудио и видео до 25 МБ. Вложения сохраняются внутри проекта.</p><p>Звук и видео на проекторе запускаются в окне зрителей.</p></aside></div><div class="dialog-actions"><span class="muted">Изменения сохраняются автоматически</span>${button('close-modal','Готово','primary')}</div></div>`,'[data-qfield="text"]');
}
function closeModal() {
  if(modal.querySelector('[data-qfield="value"]')&&!modal.querySelector('[data-qfield="value"]').reportValidity()) return;
  modal.close();draftQuestion=null;render();
  if(lastQuestionFocus) {app.querySelector(`[data-action="question"][data-id="${lastQuestionFocus}"]`)?.focus({preventScroll:true});lastQuestionFocus=null;}
}
function downloadProject() {
  if(!project)return;
  const blob=new Blob([exportProject(project)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`${(project.title||'Моя игра').replace(/[<>:"/\\|?*\x00-\x1F]/g,'_').slice(0,80)}.svoya.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),15000);
  toast('Файл проекта подготовлен. Его можно открыть на любом компьютере.');
}
function setChannel() {
  if(channel){channel.postMessage({type:'end'});channel.close();}screenSeenAt=0;
  if(typeof BroadcastChannel==='undefined'){toast('Этот браузер не поддерживает отдельный экран. Используй современный Chrome, Edge, Firefox или Safari.',true);return;}
  channel=new BroadcastChannel(`svoya-screen-${game.id}`);
  channel.onmessage=event=>{
    if(event.data?.type==='ready'||event.data?.type==='heartbeat'){screenSeenAt=Date.now();if(event.data.type==='ready')publish();}
  };
}
function publish() {
  if(channel&&game&&playProject) channel.postMessage({type:'state',state:publicState(playProject,game)});
}
function persistGame() {
  if(!game)return;
  const record={id:playProject.id,game:clone(game)};savedGames.set(record.id,{...record,project:playProject});
  db.saveGame(record).catch(()=>toast('Не удалось сохранить прогресс игры. Не закрывай пульт до конца игры.',true));
}
function gameChanged() {persistGame();publish();render();}
async function startGame(id) {
  await queueSave();const p=projects.find(p=>p.id===id);if(!p)return;
  if(!stats(p).ready){toast('Сначала заполни хотя бы один вопрос и ответ.',true);return;}
  let record=savedGames.get(p.id)||await db.loadGame(p.id);
  if(record && !record.game.finished) {
    const resume=await confirmDialog('Есть сохранённая игра','Продолжить с прежним счётом и сыгранными вопросами? «Новая игра» откроет текущую версию проекта.','Продолжить','Новая игра');
    if(resume===null)return;
    if(resume){playProject=validateProject(record.project);game=record.game;game.revealed=false;game.blank=false;game.timer={remaining:secondsLeft(game),endsAt:null};}
    else {playProject=clone(p);game=createGame(p);}
  } else {playProject=clone(p);game=createGame(p);}
  await db.saveGameSnapshot(playProject);
  project=p;view='game';setChannel();gameChanged();document.querySelector('#main').focus({preventScroll:true});
}
function openScreen() {
  if(!channel){toast('Отдельный экран не поддерживается этим браузером.',true);return;}
  screenWindow=window.open(`./projector.html#${game.id}`,`svoya-screen-${game.id}`,'popup,width=1280,height=800');
  if(!screenWindow){toast('Браузер заблокировал окно. Разреши всплывающие окна для этого сайта и нажми ещё раз.',true);return;}
  publish();
}
function help() {
  showModal(`<div class="dialog-content help-dialog"><div class="dialog-top"><h2>Твой первый игровой вечер</h2>${button('close-modal','×','icon-btn','aria-label="Закрыть"')}</div><ol class="help-steps"><li><b>Собери игру</b><p>Добавь темы, вопросы, ответы и вложения. Незаполненные вопросы в игре недоступны.</p></li><li><b>Сохрани файл</b><p>Автосохранение работает в этом браузере. «Скачать проект» создаёт резервную копию со всеми вложениями. «Открыть файл» загружает её как отдельный проект.</p></li><li><b>Подключи проектор в режиме расширения</b><p>Windows: Win + P → «Расширить». Mac: настройки дисплеев → использовать как расширенный дисплей. Дублирование покажет зрителям твой пульт вместе с ответами.</p></li><li><b>Открой два окна</b><p>Нажми «Провести игру», затем «Открыть экран зрителей». Перенеси новое окно на проектор и разверни его. Для онлайн-звонка демонстрируй только это окно.</p></li><li><b>Веди игру</b><p>Выбирай вопросы, запускай таймер и начисляй баллы. Ответ виден ведущему сразу; зрителям — только после кнопки «Показать ответ». «Завершить вопрос» убирает его из таблицы.</p></li></ol><div class="help-tip">Оба окна работают на одном компьютере и в одном браузере. Подключение телефона как отдельного пульта не требуется и не поддерживается.</div><div class="dialog-actions">${button('close-modal','Всё понятно','primary')}</div></div>`);
}
async function action(target) {
  const a=target.dataset.action,id=target.dataset.id;
  if(a==='close-modal'){closeModal();return;}
  if(a==='help'){help();return;}
  if(a==='import'){importInput.click();return;}
  if(a==='export'){downloadProject();return;}
  if(a==='library'){
    if(view==='game'){game.blank=true;game.timer={remaining:secondsLeft(game),endsAt:null};persistGame();publish();}
    await queueSave();view='library';render(true);return;
  }
  if(a==='new'){await queueSave();const p=createProject();await db.saveProject(p);projects.unshift(p);await chooseProject(p.id);return;}
  if(a==='edit'){await chooseProject(id);return;}
  if(a==='duplicate'){const p=validateProject(projects.find(p=>p.id===id),true);p.title=`${p.title.slice(0,145)} — копия`;await db.saveProject(p);projects.unshift(p);render();toast('Копия создана.');return;}
  if(a==='delete'){
    if(await confirmDialog('Удалить проект?','Проект будет удалён из этого браузера. Скачанный файл останется.','Удалить')){await db.deleteProject(id);projects=projects.filter(p=>p.id!==id);if(project?.id===id)project=null;render();}return;
  }
  if(a==='start'){await startGame(id);return;}
  if(view==='editor'){
    const r=getRound();
    if(a==='question'){openQuestionEditor(id);return;}
    if(a==='round'){selectedRound=id;render();return;}
    if(a==='add-round'&&project.rounds.length<12){const nr=round(`Раунд ${project.rounds.length+1}`);project.rounds.push(nr);selectedRound=nr.id;}
    else if(a==='delete-round'&&project.rounds.length>1){if(!await confirmDialog('Удалить раунд?','Все вопросы этого раунда будут удалены.','Удалить'))return;project.rounds=project.rounds.filter(item=>item.id!==r.id);selectedRound=project.rounds[0].id;}
    else if(a==='add-category'&&r.categories.length<10){r.categories.push({id:uid(),name:`Тема ${r.categories.length+1}`,questions:r.categories[0].questions.map(q=>question(q.value))});}
    else if(a==='delete-category'&&r.categories.length>1){if(!await confirmDialog('Удалить тему?','Все вопросы этой темы будут удалены.','Удалить'))return;r.categories=r.categories.filter(c=>c.id!==id);}
    else if(a==='add-row'&&r.categories[0].questions.length<10){r.categories.forEach(c=>c.questions.push(question(Math.min(100000,(c.questions.at(-1)?.value||0)+100))));}
    else if(a==='delete-row'&&r.categories[0].questions.length>1){if(!await confirmDialog('Удалить последнюю строку?','Последний вопрос каждой темы будет удалён.','Удалить'))return;r.categories.forEach(c=>c.questions.pop());}
    else if(a==='add-team'&&project.teams.length<12){project.teams.push(`Команда ${project.teams.length+1}`);}
    else if(a==='delete-team'&&project.teams.length>1){project.teams.splice(Number(target.dataset.index),1);}
    else if(a==='remove-media'&&draftQuestion){draftQuestion.media=null;markChanged();modal.close();openQuestionEditor(draftQuestion.id);return;}
    else return;
    markChanged();render();return;
  }
  if(view==='game'){
    if(a==='screen'){openScreen();return;}
    if(a==='exit-game'){game.blank=true;game.timer={remaining:secondsLeft(game),endsAt:null};persistGame();publish();view='editor';selectedRound=project.rounds[0].id;render(true);return;}
    if(a==='open-question'){if(!openQuestion(playProject,game,id))return;}
    else if(a==='reveal'){game.revealed=!game.revealed;game.timer={remaining:secondsLeft(game),endsAt:null};}
    else if(a==='close-question'){closeQuestion(game);}
    else if(a==='cancel-question'){closeQuestion(game,false);}
    else if(a==='score'){changeScore(game,id,Number(target.dataset.delta));}
    else if(a==='undo'){undoScore(game);}
    else if(a==='game-round'&&!game.questionId){game.roundId=id;game.finished=false;}
    else if(a==='blank'){game.blank=!game.blank;}
    else if(a==='finish'){game.finished=!game.finished;game.timer={remaining:secondsLeft(game),endsAt:null};}
    else if(a==='timer'&&game.questionId&&playProject.timer){
      if(game.timer.endsAt)game.timer={remaining:secondsLeft(game),endsAt:null};
      else {const remaining=game.timer.remaining||playProject.timer;game.timer={remaining,endsAt:Date.now()+remaining*1000};}
    }
    else if(a==='reset-timer'){game.timer={remaining:playProject.timer,endsAt:null};}
    else if(a==='restart'){
      if(!await confirmDialog('Начать заново?','Счёт команд и отметки сыгранных вопросов будут сброшены.','Начать'))return;
      const sessionId=game.id;game=createGame(playProject);game.id=sessionId;toast('Счёт и таблица сброшены. Экран зрителей подключён к новой игре.');
    }
    else if(a==='manual-score'){
      const team=game.teams.find(t=>t.id===id);
      showModal(`<form id="score-form" class="dialog-content"><div class="dialog-top"><h2>${e(team.name)}</h2></div><label>Добавить или вычесть баллы<input id="score-delta" type="number" min="-1000000" max="1000000" step="1" value="0" required></label><p class="muted">Например, 250 или −100. Сейчас: ${team.score}.</p><div class="dialog-actions">${button('close-modal','Отмена')}<button class="btn primary" type="submit">Применить</button></div></form>`,'#score-delta');
      modal.querySelector('form').addEventListener('submit',event=>{event.preventDefault();try{changeScore(game,id,Number(modal.querySelector('#score-delta').value));modal.close();gameChanged();}catch(err){toast(err.message,true);}});return;
    }
    else return;
    gameChanged();
  }
}

document.addEventListener('click',event=>{
  const target=event.target.closest('[data-action]');if(!target)return;event.preventDefault();if(target.disabled)return;
  Promise.resolve(action(target)).catch(err=>toast(err.message||'Не удалось выполнить действие.',true));
});
document.addEventListener('input',event=>{
  const el=event.target;
  if(!project||view!=='editor')return;
  if(el.dataset.qfield&&draftQuestion){const key=el.dataset.qfield;if(key==='value'){if(!el.validity.valid||el.value==='')return;draftQuestion.value=Number(el.value);}else draftQuestion[key]=el.value;markChanged();return;}
  if(el.dataset.field){
    const field=el.dataset.field;
    if(field==='round-name')getRound().name=el.value;
    else if(field==='timer'){if(!el.validity.valid||el.value==='')return;project.timer=Number(el.value);}
    else project[field]=el.value;
    markChanged();
    if(field==='round-name'){const tab=app.querySelector(`[data-action="round"][data-id="${selectedRound}"]`);if(tab){const index=project.rounds.findIndex(r=>r.id===selectedRound);tab.innerHTML=`<span>${String(index+1).padStart(2,'0')}</span> ${e(el.value)}`;}}
  } else if(el.dataset.category){getRound().categories.find(c=>c.id===el.dataset.category).name=el.value;markChanged();}
  else if(el.dataset.team!==undefined){project.teams[Number(el.dataset.team)]=el.value;markChanged();}
});
document.addEventListener('change',async event=>{
  if(event.target.id!=='media-file'||!event.target.files[0]||!draftQuestion)return;
  const file=event.target.files[0],kind=file.type.split('/')[0],q=draftQuestion;
  if(!['image','audio','video'].includes(kind)){toast('Этот формат файла не поддерживается.',true);return;}
  if(file.size>(kind==='image'?8:25)*1024*1024){toast(`Максимальный размер ${kind==='image'?'изображения — 8':'аудио или видео — 25'} МБ.`,true);return;}
  try{
    const src=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Не удалось прочитать файл.'));reader.readAsDataURL(file);});
    const media=validateMedia({kind,src,name:file.name});
    const previous=q.media;q.media=media;
    if(exportProject(project).length>MAX_FILE){q.media=previous;throw new Error('Проект больше 80 МБ. Сократи размер вложений.');}
    markChanged();if(draftQuestion===q){modal.querySelector('#media-preview').innerHTML=mediaHTML(media);modal.querySelector('[data-action="remove-media"]').disabled=false;}
    toast('Вложение добавлено в проект.');
  }catch(err){toast(err.message,true);}
});
importInput.addEventListener('change',async()=>{
  const file=importInput.files[0];importInput.value='';if(!file)return;
  try{
    if(file.size>MAX_FILE)throw new Error('Файл больше 80 МБ.');
    const p=importProject(await file.text());await db.saveProject(p);projects.unshift(p);await chooseProject(p.id);toast('Проект открыт как отдельная копия.');
  }catch(err){toast(err.message,true);}
});
modal.addEventListener('cancel',event=>{
  if(modal.querySelector('[data-confirm]'))return;
  event.preventDefault();closeModal();
});
document.addEventListener('keydown',event=>{
  if(view!=='game'||modal.open||/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement.tagName))return;
  if(event.code==='Space'){event.preventDefault();action({dataset:{action:'timer'}});}
  if(event.key==='Escape'){event.preventDefault();game.blank=!game.blank;gameChanged();}
});
window.addEventListener('beforeunload',event=>{if(unsaved||pendingSaves){event.preventDefault();event.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')queueSave();});
setInterval(()=>{
  if(view!=='game'||!game)return;
  const timer=document.querySelector('#timer-value');if(timer)timer.textContent=playProject.timer?secondsLeft(game):'∞';
  if(game.timer.endsAt&&secondsLeft(game)===0){game.timer={remaining:0,endsAt:null};gameChanged();}
  const status=document.querySelector('#screen-status');if(status)status.textContent=Date.now()-screenSeenAt<6000?'Экран подключён':'Экран не открыт';
},250);
setInterval(()=>{if(view==='game'&&channel){channel.postMessage({type:'ping'});}},2000);

async function init() {
  try{
    projects=(await db.allProjects()).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    if(!projects.length){const demo=demoProject();await db.saveProject(demo);projects=[demo];}
    render();
    if(navigator.storage?.persist) navigator.storage.persist().catch(()=>{});
  }catch(err){app.innerHTML=`<main class="storage-error"><div class="wordmark">своя<span>✳</span></div><h1>Не удалось открыть хранилище</h1><p>${e(err.message)}</p><p>Разреши хранение данных сайта в браузере и обнови страницу. В приватном режиме данные могут исчезнуть после закрытия окна.</p><button class="btn primary" onclick="location.reload()">Попробовать снова</button></main>`;}
}
init();
