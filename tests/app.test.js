import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
import {escapeHTML} from '../core.js';

// DOM integration, not a real-browser visual test. Both windows use the production rendering and event handlers.
class Channel {
  static all=new Set(); static messages=[];
  constructor(name){this.name=name;Channel.all.add(this);}
  postMessage(data){Channel.messages.push(structuredClone(data));for(const other of Channel.all)if(other!==this&&other.name===this.name)queueMicrotask(()=>other.onmessage?.({data:structuredClone(data)}));}
  close(){Channel.all.delete(this);}
}
const wait=async predicate=>{for(let i=0;i<120;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}assert.fail('UI did not reach expected state');};
const click=async(doc,selector)=>{const el=doc.querySelector(selector);assert.ok(el,selector);assert.ok(!el.disabled,selector);el.click();await new Promise(r=>setTimeout(r,15));};
const input=(doc,selector,value)=>{const el=doc.querySelector(selector);assert.ok(el,selector);el.value=value;el.dispatchEvent(new doc.defaultView.Event('input',{bubbles:true}));};
let dom,screenDOM,downloaded;
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const screenHTML=await readFile(new URL('../projector.html',import.meta.url),'utf8');
const screenJS=(await readFile(new URL('../screen.js',import.meta.url),'utf8')).replace(/^import .*?;\n/,'');
const realInterval=globalThis.setInterval;
async function boot(suffix){
  dom=new JSDOM(html,{url:'https://test.local/svoya-studio/',pretendToBeVisual:true});
  const w=dom.window;
  Object.assign(globalThis,{window:w,document:w.document,FileReader:w.FileReader,indexedDB,BroadcastChannel:Channel});
  Object.defineProperty(globalThis,'navigator',{value:w.navigator,configurable:true});
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  const anchorClick=w.HTMLAnchorElement.prototype.click;
  w.HTMLAnchorElement.prototype.click=function(){if(!this.download)anchorClick.call(this);};
  globalThis.setInterval=()=>0;
  w.open=(url)=>{
    screenDOM=new JSDOM(screenHTML,{url:new URL(url,w.location.href).href,runScripts:'outside-only'});
    screenDOM.window.BroadcastChannel=Channel;screenDOM.window.e=escapeHTML;screenDOM.window.setInterval=()=>0;
    screenDOM.window.eval(screenJS);return screenDOM.window;
  };
  await import(`../app.js?test=${suffix}`);
  await wait(()=>w.document.querySelector('.projects'));
  return w.document;
}
test('editor → autosave → export/import → host/projector → reveal → scoring → resume',async()=>{
  const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
  URL.createObjectURL=blob=>{downloaded=blob;return 'blob:test';};URL.revokeObjectURL=()=>{};
  try{
    let doc=await boot('first');
    assert.equal(doc.querySelectorAll('.project-card').length,1);
    await click(doc,'[data-action="new"]');await wait(()=>doc.querySelector('[data-field="title"]'));
    input(doc,'[data-field="title"]','Проверенная игра');
    await click(doc,'[data-action="question"]');
    input(doc,'[data-qfield="text"]','Какой ответ? <img src=x onerror=bad>');
    input(doc,'[data-qfield="answer"]','SECRET_ANSWER_947');input(doc,'[data-qfield="notes"]','PRIVATE_NOTES_813');
    assert.equal(doc.querySelector('img[src="x"]'),null);
    const fileInput=doc.querySelector('#media-file');
    const png=new dom.window.File(['image-bytes'],'picture.png',{type:'image/png'});
    Object.defineProperty(fileInput,'files',{value:[png],configurable:true});fileInput.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    await wait(()=>doc.querySelector('#media-preview img'));
    await click(doc,'[data-action="close-modal"]');await wait(()=>doc.querySelector('.question-cell.ready'));
    await new Promise(r=>setTimeout(r,450));assert.match(doc.querySelector('#save-status').textContent,/Сохранено/);
    await click(doc,'[data-action="export"]');
    const portable=JSON.parse(await downloaded.text());
    assert.equal(portable.project.title,'Проверенная игра');
    assert.equal(portable.project.rounds[0].categories[0].questions[0].answer,'SECRET_ANSWER_947');
    assert.match(portable.project.rounds[0].categories[0].questions[0].media.src,/^data:image\/png;base64,/);
    await click(doc,'[data-action="start"]');await wait(()=>doc.querySelector('.game-header'));
    await click(doc,'[data-action="screen"]');await wait(()=>screenDOM?.window.document.querySelector('.audience-board'));
    let audience=screenDOM.window.document;
    assert.doesNotMatch(audience.body.textContent,/SECRET|PRIVATE/);
    await click(doc,'[data-action="open-question"]:not(:disabled)');await wait(()=>audience.querySelector('.audience-question'));
    assert.match(doc.querySelector('.private-answer').textContent,/SECRET_ANSWER_947/);
    assert.doesNotMatch(audience.documentElement.outerHTML,/SECRET|PRIVATE/);
    assert.equal(audience.querySelector('img[src="x"]'),null);
    const audienceImage=audience.querySelector('.audience-media img');
    await click(doc,'[data-action="reveal"]');await wait(()=>audience.querySelector('#audience-answer').textContent==='SECRET_ANSWER_947');
    assert.doesNotMatch(audience.documentElement.outerHTML,/PRIVATE_NOTES/);
    await click(doc,'[data-action="reveal"]');await wait(()=>audience.querySelector('#audience-answer').hidden);
    assert.doesNotMatch(audience.documentElement.outerHTML,/SECRET|PRIVATE/);
    await click(doc,'[data-action="score"][data-delta="100"]');
    assert.equal(doc.querySelector('.score-team strong').textContent,'100');
    await wait(()=>audience.querySelector('.audience-team strong').textContent==='100');
    assert.equal(audience.querySelector('.audience-media img'),audienceImage,'Scoring must not reload audience media');
    await click(doc,'[data-action="score"][data-delta="-100"]');await click(doc,'[data-action="undo"]');
    assert.equal(doc.querySelector('.score-team strong').textContent,'100');
    await click(doc,'[data-action="timer"]');assert.equal(doc.querySelector('[data-action="timer"]').textContent,'Пауза');
    await click(doc,'[data-action="close-question"]');await wait(()=>audience.querySelector('.audience-board'));
    assert.ok(doc.querySelector('[data-action="open-question"]').disabled);
    assert.doesNotMatch(audience.documentElement.outerHTML,/SECRET|PRIVATE/);
    await click(doc,'[data-action="exit-game"]');
    // A fresh app instance loads real persisted IndexedDB data, not the first app's memory.
    for(const c of Channel.all)c.close();screenDOM.window.close();dom.window.close();
    doc=await boot('reload');
    const cards=[...doc.querySelectorAll('.project-card')],card=cards.find(c=>c.querySelector('h3').textContent==='Проверенная игра');
    assert.ok(card);card.querySelector('[data-action="start"]').click();await wait(()=>doc.querySelector('[data-confirm="yes"]'));
    await click(doc,'[data-confirm="yes"]');await wait(()=>doc.querySelector('.game-header'));
    assert.equal(doc.querySelector('.score-team strong').textContent,'100');assert.ok(doc.querySelector('[data-action="open-question"]').disabled);
    await click(doc,'[data-action="screen"]');await wait(()=>screenDOM.window.document.querySelector('.audience-board'));
    audience=screenDOM.window.document;
    await click(doc,'[data-action="restart"]');await click(doc,'[data-confirm="yes"]');
    assert.equal(doc.querySelector('.score-team strong').textContent,'0');
    await wait(()=>audience.querySelector('.audience-board td').textContent==='100');
    assert.ok(!doc.querySelector('[data-action="open-question"]').disabled);
    await click(doc,'[data-action="exit-game"]');
    const file=doc.querySelector('#import-file');Object.defineProperty(file,'files',{value:[{size:downloaded.size,text:()=>downloaded.text()}],configurable:true});
    file.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await wait(()=>doc.querySelector('#toast').textContent.includes('отдельная копия'));
    assert.equal(doc.querySelector('[data-field="title"]').value,'Проверенная игра');
    await click(doc,'[data-action="add-category"]');assert.equal(doc.querySelectorAll('.editor-board th').length,6);
    await click(doc,'[data-action="add-row"]');assert.equal(doc.querySelectorAll('.question-cell').length,36);
    await click(doc,'[data-action="delete-row"]');await click(doc,'[data-confirm="no"]');assert.equal(doc.querySelectorAll('.question-cell').length,36);
    await click(doc,'[data-action="delete-row"]');await click(doc,'[data-confirm="yes"]');assert.equal(doc.querySelectorAll('.question-cell').length,30);
    await click(doc,'[data-action="add-round"]');assert.equal(doc.querySelectorAll('[role="tab"]').length,2);
    await click(doc,'[data-action="delete-round"]');await click(doc,'[data-confirm="yes"]');assert.equal(doc.querySelectorAll('[role="tab"]').length,1);
    await click(doc,'[data-action="add-team"]');assert.equal(doc.querySelectorAll('[data-team]').length,4);
    await click(doc,'[data-action="delete-team"][data-index="3"]');assert.equal(doc.querySelectorAll('[data-team]').length,3);
    await click(doc,'[data-action="library"]');
    assert.equal(doc.querySelectorAll('.project-card').length,3);
    assert.ok(Channel.messages.every(m=>m.type!=='state'||!JSON.stringify(m.state).includes('PRIVATE_NOTES_813')));
  }finally{globalThis.setInterval=realInterval;URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;dom?.window.close();screenDOM?.window.close();for(const c of Channel.all)c.close();}
});
