import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject, demoProject, stats, isReady, question, validateProject, validateMedia,
  importProject, exportProject, createGame, publicState, openQuestion, closeQuestion,
  changeScore, undoScore, secondsLeft, escapeHTML} from '../core.js';

test('new projects are blank, demo has 20 playable questions',()=>{
  const p=createProject();assert.deepEqual(stats(p),{total:25,ready:0});
  assert.deepEqual(stats(demoProject()),{total:20,ready:20});
  assert.equal(isReady({...question(),text:' ',answer:'yes'}),false);
});
test('portable export/import preserves questions, notes and embedded media, creates an independent project',()=>{
  const p=demoProject(),q=p.rounds[0].categories[0].questions[0];
  q.notes='Заметки только ведущему';q.media={kind:'image',src:'data:image/png;base64,aGVsbG8=',name:'тест.png'};
  const restored=importProject(exportProject(p));
  assert.notEqual(restored.id,p.id);assert.deepEqual(restored.rounds,p.rounds);assert.deepEqual(restored.teams,p.teams);
});
test('import rejects malformed projects, incompatible versions, unsafe media and out of bounds fields',()=>{
  assert.throws(()=>importProject('{'),/JSON/);assert.throws(()=>importProject('{}'),/поддерживаемый/);
  for(const mutation of [p=>p.timer=-1,p=>p.teams=[],p=>p.rounds=[],p=>p.rounds[0].categories[0].questions[0].value=NaN,p=>p.rounds[0].categories[0].questions.pop()]){
    const p=demoProject();mutation(p);assert.throws(()=>validateProject(p));
  }
  for(const media of [{kind:'image',src:'javascript:alert(1)',name:'bad'},{kind:'image',src:'data:image/svg+xml;base64,YQ==',name:'bad'},{kind:'video',src:'https://example.com/video.mp4',name:'bad'}])assert.throws(()=>validateMedia(media));
});
test('duplicate IDs are repaired; imported HTML stays text',()=>{
  const p=demoProject();p.rounds[0].categories[0].questions[0].id=p.rounds[0].id;
  const safe=validateProject(p);assert.notEqual(safe.rounds[0].id,safe.rounds[0].categories[0].questions[0].id);
  assert.equal(escapeHTML('<img src=x onerror="bad">'), '&lt;img src=x onerror=&quot;bad&quot;&gt;');
});
test('audience state contains no answer or notes until explicit reveal; boards never contain answers',()=>{
  const p=demoProject(),q=p.rounds[0].categories[0].questions[0],g=createGame(p);
  q.answer='SECRET_ANSWER';q.notes='PRIVATE_NOTES';
  q.media={kind:'image',src:'data:image/png;base64,aGVsbG8=',name:'PRIVATE_FILENAME'};
  assert.doesNotMatch(JSON.stringify(publicState(p,g)),/SECRET|PRIVATE/);
  assert.equal(openQuestion(p,g,q.id),true);
  const publicQuestion=publicState(p,g).question;assert.equal(Object.hasOwn(publicQuestion,'answer'),false);
  assert.doesNotMatch(JSON.stringify(publicState(p,g)),/SECRET|PRIVATE/);
  g.revealed=true;assert.equal(publicState(p,g).question.answer,'SECRET_ANSWER');
  assert.doesNotMatch(JSON.stringify(publicState(p,g)),/PRIVATE/);
  g.revealed=false;assert.doesNotMatch(JSON.stringify(publicState(p,g)),/SECRET/);
  closeQuestion(g);assert.doesNotMatch(JSON.stringify(publicState(p,g)),/SECRET|PRIVATE/);
});
test('game cannot open incomplete or used questions, can return an unplayed question',()=>{
  const p=createProject(),g=createGame(p),q=p.rounds[0].categories[0].questions[0];
  assert.equal(openQuestion(p,g,q.id),false);q.text='Question';q.answer='Answer';
  assert.equal(openQuestion(p,g,q.id),true);closeQuestion(g,false);assert.equal(openQuestion(p,g,q.id),true);
  closeQuestion(g);assert.equal(g.used.length,1);assert.equal(openQuestion(p,g,q.id),false);
  assert.equal(openQuestion(p,g,'missing'),false);
});
test('scores support negatives, exact undo and validation; teams are isolated',()=>{
  const g=createGame(demoProject()),id=g.teams[0].id;
  changeScore(g,id,100);changeScore(g,id,-250);assert.equal(g.teams[0].score,-150);assert.equal(g.teams[1].score,0);
  undoScore(g);assert.equal(g.teams[0].score,100);undoScore(g);assert.equal(g.teams[0].score,0);
  assert.throws(()=>changeScore(g,id,Infinity));assert.throws(()=>changeScore(g,id,1.5));assert.throws(()=>changeScore(g,'missing',100));
});
test('timer uses wall clock, survives throttling and never becomes negative',()=>{
  const g=createGame(demoProject());g.timer={remaining:30,endsAt:31000};
  assert.equal(secondsLeft(g,1000),30);assert.equal(secondsLeft(g,21001),10);assert.equal(secondsLeft(g,100000),0);
  g.timer={remaining:14,endsAt:null};assert.equal(secondsLeft(g,100000),14);
});
