import {escapeHTML as e} from './core.js';

const root=document.querySelector('#screen'),connection=document.querySelector('#connection');
const session=location.hash.slice(1);
let channel,state=null,lastSignal=0,questionKey=null,mode=null;
function send(type){channel?.postMessage({type});}
function scoresHTML(teams){return teams.map(t=>`<div class="audience-team"><span>${e(t.name)}</span><strong>${e(t.score)}</strong></div>`).join('');}
function mediaHTML(media){
  if(!media)return '';
  if(media.kind==='image')return `<img src="${e(media.src)}" alt="Иллюстрация к вопросу">`;
  if(media.kind==='audio'||media.kind==='video')return `<${media.kind} src="${e(media.src)}" controls preload="metadata" ${media.kind==='video'?'playsinline':''}></${media.kind}>`;
  return '';
}
function update(next){
  state=next;lastSignal=Date.now();connection.textContent='Связь с ведущим установлена';
  if(state.blank){if(mode!=='blank')root.innerHTML='<div class="blank-screen" aria-label="Экран временно скрыт"></div>';mode='blank';questionKey=null;return;}
  if(state.finished){
    const teams=[...state.teams].sort((a,b)=>b.score-a.score);
    root.innerHTML=`<div class="audience-results"><span class="screen-eyebrow">${e(state.title)}</span><div class="result-star" aria-hidden="true">✳</div><h1>Отличная игра!</h1><div class="ranking">${teams.map((t,i)=>`<div><span class="rank">${i&&teams[i-1].score===t.score?'=':i+1}</span><b>${e(t.name)}</b><strong>${e(t.score)}</strong></div>`).join('')}</div></div>`;
    mode='finished';questionKey=null;return;
  }
  if(state.question){
    const q=state.question,key=q.id;
    if(mode!=='question'||questionKey!==key){
      root.innerHTML=`<section class="audience-question"><header><span>${e(q.category)} <i>/</i> ${e(q.value)}</span><span class="screen-brand">своя✳</span></header><div class="audience-question-body"><h1>${e(q.text)}</h1>${q.media?`<div class="audience-media">${mediaHTML(q.media)}</div>`:''}<div id="audience-answer" aria-live="polite" hidden></div></div><footer><div class="audience-scores"></div><div id="audience-timer" class="audience-timer"></div></footer></section>`;
      questionKey=key;
    }
    const answer=document.querySelector('#audience-answer');answer.hidden=!q.revealed;answer.textContent=q.revealed?q.answer:'';
    root.querySelector('.audience-scores').innerHTML=scoresHTML(state.teams);
    mode='question';updateTimer();return;
  }
  root.innerHTML=`<section class="audience-board-wrap"><header><div><span class="screen-eyebrow">${e(state.round)}</span><h1>${e(state.title)}</h1></div><span class="screen-brand">своя✳</span></header><div class="audience-board-scroll"><table class="audience-board" style="--columns:${state.board.length}"><thead><tr>${state.board.map(c=>`<th scope="col">${e(c.name)}</th>`).join('')}</tr></thead><tbody>${(state.board[0]?.questions||[]).map((_,i)=>`<tr>${state.board.map(c=>{const q=c.questions[i];return `<td class="${q.used||!q.ready?'played':''}">${q.used?'—':q.ready?e(q.value):'·'}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div><footer class="audience-scores">${scoresHTML(state.teams)}</footer></section>`;
  mode='board';questionKey=null;
}
function updateTimer(){
  const el=document.querySelector('#audience-timer');if(!el||!state)return;
  const left=state.timer.endsAt?Math.max(0,Math.ceil((state.timer.endsAt-Date.now())/1000)):state.timer.remaining;
  el.textContent=state.timer.enabled?left:'';el.classList.toggle('time-up',state.timer.enabled&&left===0);
}
const fullscreenButton=document.querySelector('#fullscreen');
fullscreenButton.addEventListener('click',async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}
  catch{connection.textContent='Для полного экрана нажми F11 (или Control + Command + F на Mac).';}
});
document.addEventListener('fullscreenchange',()=>{fullscreenButton.textContent=document.fullscreenElement?'Выйти из полного экрана':'На весь экран ⛶';});
let hideToolsTimer;
document.addEventListener('pointermove',()=>{
  document.body.classList.add('show-tools');clearTimeout(hideToolsTimer);hideToolsTimer=setTimeout(()=>document.body.classList.remove('show-tools'),3000);
});
if(!session||!/^[-\w]{1,80}$/.test(session))connection.textContent='Открой экран из пульта ведущего';
else if(typeof BroadcastChannel==='undefined')connection.textContent='Браузер не поддерживает отдельный экран';
else{
  channel=new BroadcastChannel(`svoya-screen-${session}`);
  channel.onmessage=event=>{
    if(event.data?.type==='end'){root.innerHTML='<div class="blank-screen" aria-label="Ведущий открыл другую игру"></div>';state=null;mode='blank';connection.textContent='Ведущий открыл другую игру. Откройте новый экран из пульта.';channel.close();channel=null;return;}
    if(event.data?.type==='ping'){lastSignal=Date.now();send('heartbeat');connection.textContent='Связь с ведущим установлена';}
    if(event.data?.type==='state'){update(event.data.state);send('heartbeat');}
  };
  send('ready');
  setInterval(()=>{
    if(!state)send('ready');else send('heartbeat');
    if(lastSignal&&Date.now()-lastSignal>8000)connection.textContent='Нет связи с ведущим · изображение сохранено';
  },2000);
}
setInterval(updateTimer,200);
