import { createProjectStore } from './storage.js';
import { initializeAudio, playSequenceStep, setMasterVolume, resetAudioForForegroundPlayback, beginOfflineAudioRender } from './audio.js?v=20261001-piano-root60-attack0-v1';
import { createProjectSoundBank } from './sound-defaults.js';

const STEP_COUNT = 64;

// chillgen currently uses the teacher-MIDI-derived generator as the single engine.
function activeGenerator(){
  return {generateMelo:generateMeloG15,generateRhythm:generateRhythmG01};
}

const LATEST_STATE_KEY = 'moacl.latest-state.v1';
let songTitle = 'untitled';
const songTitleButton = document.querySelector('#song-title');
const titleDialog = document.querySelector('#title-dialog');
const titleInput = document.querySelector('#title-input');
function updateSongTitle(){ songTitleButton.textContent = songTitle; songTitleButton.title = songTitle; }
function closeTitleDialog(){ titleDialog.hidden = true; songTitleButton.focus(); }
songTitleButton.addEventListener('click',()=>{ titleInput.value = songTitle === 'untitled' ? '' : songTitle; titleDialog.hidden = false; titleInput.focus(); titleInput.select(); });
document.querySelector('#title-cancel').addEventListener('click',closeTitleDialog);
document.querySelector('#title-save').addEventListener('click',()=>{ const next = titleInput.value.trim().replace(/\s+/g,' ').slice(0,80) || 'untitled'; if(next !== songTitle){ songTitle = next; updateSongTitle(); saveLatestState(); projectStore.renameCurrent(next).catch(console.error); } closeTitleDialog(); });
titleInput.addEventListener('keydown',event=>{ if(event.key === 'Enter'){ event.preventDefault(); document.querySelector('#title-save').click(); } else if(event.key === 'Escape'){ event.preventDefault(); closeTitleDialog(); } });
titleDialog.addEventListener('click',event=>{if(event.target === titleDialog)closeTitleDialog();});
updateSongTitle();
let activeStepCount = 32;
const SCALE = [0,2,4,5,7,9,11];
// Profile 3: modal-cool root pool. Same pitch classes as Locrian, used ONLY for chord roots.
const COOL_ROOT_OFFSETS = [0,1,3,5,6,8,10];
const COOL_COLORS = [
  {name:'m7', intervals:[0,3,7,10], w:1.0},
  {name:'m9', intervals:[0,2,3,7,10], w:1.0},
  {name:'m11', intervals:[0,2,3,5,7,10], w:1.0},
  {name:'7sus4', intervals:[0,5,7,10], w:1.0},
  {name:'9sus4', intervals:[0,2,5,7,10], w:1.0}
];
const KEY_NAMES = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const NOTE_NAMES = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const RANGE_MIN = 48; // C3
const RANGE_MAX = 83; // B5
let keyRoot = 0;
const DEGREE_NAMES = ['I','ii','iii','IV','V','vi','viiø'];
// Each degree owns a harmonic vocabulary expressed in C-relative pitch classes.
// keyRoot transposes those pitch classes at voicing time; the absolute Melo window stays C3-B5.
const COLORS = [
  [
    {name:'Cmaj7', tones:[0,4,7,11], w:4.0}, {name:'C6', tones:[0,4,7,9], w:2.0},
    {name:'Cmaj9', tones:[0,2,4,7,11], w:2.6}
  ],
  [
    {name:'Dm7', tones:[2,5,9,0], w:4.0}, {name:'Dm9', tones:[2,4,5,9,0], w:3.0}
  ],
  [
    {name:'Em7', tones:[4,7,11,2], w:4.0}, {name:'Em9', tones:[4,6,7,11,2], w:.35}
  ],
  [
    {name:'Fmaj7', tones:[5,9,0,4], w:4.0}, {name:'F6', tones:[5,9,0,2], w:1.8},
    {name:'Fmaj9', tones:[5,7,9,0,4], w:2.8}
  ],
  [
    {name:'G7', tones:[7,11,2,5], w:4.0}, {name:'G9', tones:[7,9,11,2,5], w:3.0},
    {name:'Gsus4', tones:[7,0,2], w:1.2},
    // p19: colours the user relies on in real writing.  These are explicit
    // harmonic identities, not just octave-spread versions of G7.
    {name:'G7sus4', tones:[7,0,2,5], character:[0], w:2.2, openChance:.50},
    {name:'G7(11)', tones:[7,11,2,5,0], character:[0], w:2.0, openChance:.68},
    {name:'G13', tones:[7,11,2,5,9], character:[9], w:2.0, openChance:.68}
  ],
  [
    {name:'Am7', tones:[9,0,4,7], w:4.2}, {name:'Am9', tones:[9,11,0,4,7], w:3.0}
  ],
  [
    {name:'Bm7b5', tones:[11,2,5,9], w:5.0}, {name:'Bdim', tones:[11,2,5], w:1.0}
  ]
];
// Less textbook I-IV-V bias: iii and vi are ordinary destinations, viiø remains rarer.
const NEXT = [
  [[2,2.2],[5,2.8],[3,2.0],[1,1.5],[4,1.5],[0,.4]],
  [[4,2.4],[5,1.5],[3,1.6],[0,1.0],[2,.8],[6,.4]],
  [[5,2.5],[3,2.3],[1,1.5],[4,1.0],[0,.9]],
  [[2,1.8],[1,1.5],[4,1.7],[0,1.3],[5,1.2]],
  [[0,2.0],[5,2.2],[2,1.3],[3,1.1],[1,.9]],
  [[2,2.1],[3,2.0],[1,1.7],[4,1.5],[0,1.0]],
  [[0,2.2],[2,1.4],[5,1.0],[4,.8]]
];

const bank = createProjectSoundBank();
Object.keys(bank.melodic).forEach(id => bank.melodic[id].muted = id !== '1');
Object.assign(bank.melodic['1'], { gain:30, attack:3, holdDecay:-15, filterCutoff:-12, filterResonance:0, fmDepth:0, fmRatio:1, rsend:0 });
// p20: fixed moacl Rhythm voice set, copied from the user's mono82 sound settings.
// a=Kick / b=Hat / c=Snare / d=Perc. Unspecified parameters stay at mono defaults.
Object.keys(bank.rhythm).forEach(id => bank.rhythm[id].muted = false);
Object.assign(bank.rhythm['a'], { name:'Kick', gain:100, attack:1, holdDecay:7, filterCutoff:0, note:-35, noiseMix:0, rsend:0,
  lfo1:{target:'pitch',wave:'fall',depth:95,rate:250,syncMode:'free'} });
Object.assign(bank.rhythm['b'], { name:'Hat', gain:10, attack:1, holdDecay:5, filterCutoff:50, filterResonance:15, noiseMix:100, note:0, rsend:0 });
Object.assign(bank.rhythm['c'], { name:'Snare', gain:95, attack:1, holdDecay:5, filterCutoff:37, filterResonance:0, noiseMix:25, rsend:0 });
Object.assign(bank.rhythm['d'], { name:'Perc', gain:60, attack:1, holdDecay:1, note:36, noiseMix:0, rsend:0 });

// Rhythm Generate:
// 0 = empty, 1-3 = free density, 4-6 = 16-beat grammar,
// 7-9 = the same 4-6 complexity levels with a four-on-the-floor kick spine.
const RHYTHM_MARK = {a:'k',b:'h',c:'s',d:'p'};
const RHYTHM_DENSITY_RANGES = {
  0:[0,0],
  1:[1/8,1/4],
  2:[1/4,1/2],
  3:[1/2,2/3]
};
let rhythmDensity = 3;
let swing = 0;
let selectedPattern = 1;
let queuedPattern = null;
const patternSlots = Array(16).fill(null);
const PATTERN_LABELS = ['1','2','3','4','5','6','7','8','a','b','c','d','e','f','g','h'];
let patternClipboard = null;
let lastPatternTap = null;
const undoStack=[]; const redoStack=[];
const undoButton=document.querySelector('#undo');
const redoButton=document.querySelector('#redo');
function updateHistoryButtons(){
  undoButton.disabled=undoStack.length===0;
  redoButton.disabled=redoStack.length===0;
}
updateHistoryButtons();
let rhythmEvents = Array(STEP_COUNT).fill(null);
let rhythmSubsteps = Array(STEP_COUNT).fill(0);
let meloSubsteps = Array(STEP_COUNT).fill(false);
let melodicMuted = false;
let meloLong = false;
let meloMode = 0; // 0 Short, 1 Long, 2 Tabla, 3 Harakami
let beat = 0;
function updateMeloControls(){
  const mode=document.querySelector('#melo-mode');
  const value=document.querySelector('#melo-beat');
  if(mode){mode.textContent=['・','-','>','<'][meloMode];mode.title=['Short','Long','Tabla-style pluck','Soft swell'][meloMode];}
  if(value)value.textContent=String(beat);
  bank.melodic['1'].beat=beat;
}

let rhythmMuted = false;

let model = null;
let playing = false;
let loopEnabled = false;
let runToken = 0;
let visualTimers = [];
// Track held pitches by their scheduled end; common tones are not retriggered.
const heldMelo = new Map();
function heldNoteSteps(note, stepIndex){
  // Scan forward to the first chord that drops this pitch. Empty steps hold.
  // A loop with no such chord is sustained for eight cycles as a safety bound.
  const limit=loopEnabled?activeStepCount*8:activeStepCount-stepIndex;
  for(let offset=1;offset<limit;offset++){
    const index=stepIndex+offset;
    if(!loopEnabled&&index>=activeStepCount)return offset;
    const nextStep=index%activeStepCount;
    const event=model.events[nextStep];
    // A melodic substep breaks ties on both sides of the decorated step.
    if((meloSubsteps[nextStep] && event?.notes?.length>=1 && event.notes.length<=4) || (event&&!event.notes.includes(note)))return offset;
  }
  return limit;
}

const rand = n => Math.floor(Math.random()*n);
const choice = a => a[rand(a.length)];
const weighted = pairs => { let r=Math.random()*pairs.reduce((s,x)=>s+x[1],0); for(const [v,w] of pairs){r-=w;if(r<=0)return v} return pairs.at(-1)[0]; };

const transposePc = pc => (pc + keyRoot + 120) % 12;
const regionPcs = region => region.color.tones.map(transposePc);
const scalePcs = () => SCALE.map(transposePc);
const coolRootPcs = () => COOL_ROOT_OFFSETS.map(transposePc);
function chordLabel(region){
  const rootPc=transposePc(region.rootOffset ?? SCALE[region.degree]);
  const suffix=region.color.name.replace(/^[A-G](?:#|b)?/, '');
  return NOTE_NAMES[rootPc]+suffix;
}

function chooseColor(degree){
  const pool=COLORS[degree];
  return weighted(pool.map(c=>[c,c.w]));
}

// Profile 1 / Melancholy: start from the completed diatonic language, then
// occasionally replace a local arrival with one of a few reusable "pull" devices.
// These are functions, not fixed song progressions: colours vary inside each device.
const MELANCHOLY_COLORS = {
  maj7: root => ({name:'Cmaj7', tones:[root,(root+4)%12,(root+7)%12,(root+11)%12], w:1}),
  maj9: root => ({name:'Cmaj9', tones:[root,(root+2)%12,(root+4)%12,(root+7)%12,(root+11)%12], w:1}),
  m7: root => ({name:'Cm7', tones:[root,(root+3)%12,(root+7)%12,(root+10)%12], w:1}),
  m9: root => ({name:'Cm9', tones:[root,(root+2)%12,(root+3)%12,(root+7)%12,(root+10)%12], w:1}),
  m7b59: root => ({name:'Cm7b5(9)', tones:[root,(root+2)%12,(root+3)%12,(root+6)%12,(root+10)%12], w:1, openChance:.42}),
  dim7: root => ({name:'Cdim7', tones:[root,(root+3)%12,(root+6)%12,(root+9)%12], w:1, openChance:.38}),
  passing: root => ({name:'Cpass', tones:[root], w:1}),
  dom: (root,kind) => {
    const variants={
      '7':[0,4,7,10], '9':[0,2,4,7,10], '7b9':[0,1,4,7,10],
      '7#9':[0,3,4,7,10], '7b13':[0,4,7,8,10], '7(11)':[0,4,5,7,10]
    };
    const intervals=variants[kind]||variants['7'];
    return {name:`C${kind}`, tones:intervals.map(x=>(root+x)%12), w:1, openChance:.45};
  }
};
function melancholyRegion(start,end,rootOffset,color){
  return {start,end,degree:null,rootOffset,color,profile:'melancholy'};
}
function makeMelancholyHarmonyMap(){
  // Profile 1 v3: Default decides every structural destination first.
  // Melancholy harmony is INSERTED before an existing target; the target anchor
  // itself is never replaced. Therefore a dim / secondary dominant can never
  // be left unresolved just because the next Default region starts later.
  const base=makeHarmonyMap().map(r=>({...r,profile:'melancholy'}));
  if(base.length<2)return base;

  const isMaj7Landing=r=>r && (r.degree===0 || r.degree===3) && /maj(?:7|9)/.test(r.color.name);
  const candidates=[];
  for(let t=1;t<base.length;t++){
    const target=base[t];
    const prev=base[t-1];
    const gap=target.start-prev.start;
    if(gap>=4 && isMaj7Landing(target)) candidates.push({type:'upperDim',at:t,w:2.2,need:1});
    if(gap>=6 && target.degree===3 && /maj(?:7|9)/.test(target.color.name)) candidates.push({type:'toIV',at:t,w:2.4,need:2});
    if(gap>=6 && target.degree===5) candidates.push({type:'dimToVi',at:t,w:2.1,need:2});
    if(gap>=6 && target.degree===5) candidates.push({type:'falseVI',at:t,w:.55,need:2});
  }
  if(!candidates.length)return base;

  // First correctness pass: one guaranteed-resolution device per generation.
  // Density can be raised later after the harmonic grammar is proven stable.
  const d=weighted(candidates.map(x=>[x,x.w]));
  const t=d.at;
  const target=base[t];
  const inserts=[];
  const special=(start,rootOffset,color)=>({
    start,end:start,degree:null,rootOffset,color,profile:'melancholy',
    noConnector:true,noRootSupport:true,approach:true
  });
  const passing=(start,rootOffset)=>({
    ...special(start,rootOffset,MELANCHOLY_COLORS.passing(rootOffset)),
    chromaticPassing:true
  });

  // Put approaches close to the destination. One-device phrases get two steps
  // of breathing room; ii-V / V-dim devices occupy the two preceding 2-step slots.
  if(d.type==='upperDim'){
    const targetRoot=SCALE[target.degree];
    const approach=(targetRoot+1)%12;
    // The diminished-family sound is used here only as a chromatic approach.
    // Keep the non-diatonic approach ROOT, but do not spell a full dim chord.
    inserts.push(passing(target.start-choice([1,2,3]),approach));
    target.forceRootBass=true;
  }else if(d.type==='toIV'){
    // Secondary ii-V timing is deliberately fluid. Use roughly the six steps
    // before the target, but always leave at least one EMPTY step between V
    // and the target. Only the harmonic order ii < V < target is fixed.
    const windowStart=Math.max(target.start-6,prev.start+1);
    const latestV=target.start-2;
    const pairs=[];
    for(let iiStart=windowStart;iiStart<latestV;iiStart++){
      for(let vStart=iiStart+1;vStart<=latestV;vStart++){
        pairs.push([iiStart,vStart]);
      }
    }
    if(pairs.length){
      const [iiStart,vStart]=choice(pairs);
      inserts.push(special(iiStart,7,
        Math.random()<.45?MELANCHOLY_COLORS.m9(7):MELANCHOLY_COLORS.m7(7)));
      inserts.push(special(vStart,0,
        MELANCHOLY_COLORS.dom(0,choice(['7','9','7b9','7(11)']))));
    }
  }else if(d.type==='dimToVi'){
    inserts.push(special(target.start-4,7,
      MELANCHOLY_COLORS.dom(7,choice(['7','9','7(11)']))));
    // Same idea on the way to vi: #V is a passing root, not a full dim7 sonority.
    inserts.push(passing(target.start-choice([1,2,3]),8));
    target.forceRootBass=true;
  }else if(d.type==='falseVI'){
    // The false-resolution ii-V is a secondary-dominant phrase too, so it must
    // use the same fluid timing grammar as toIV. Earlier versions left this
    // branch at target-4 / target-2, which made some secondary-dominant events
    // still sound rhythmically fixed even after toIV itself was randomized.
    const windowStart=Math.max(target.start-6,prev.start+1);
    const latestV=target.start-2; // always at least one empty step before target
    const pairs=[];
    for(let iiStart=windowStart;iiStart<latestV;iiStart++){
      for(let vStart=iiStart+1;vStart<=latestV;vStart++){
        pairs.push([iiStart,vStart]);
      }
    }
    if(pairs.length){
      const [iiStart,vStart]=choice(pairs);
      inserts.push(special(iiStart,2,
        Math.random()<.42?MELANCHOLY_COLORS.m9(2):MELANCHOLY_COLORS.m7(2)));
      inserts.push(special(vStart,7,
        MELANCHOLY_COLORS.dom(7,choice(['7','9','7b9']))));
    }
    // This event intentionally changes only the TARGET COLOUR, never its timing.
    const root=9;
    Object.assign(target,{degree:null,rootOffset:root,
      color:Math.random()<.42?MELANCHOLY_COLORS.maj9(root):MELANCHOLY_COLORS.maj7(root),
      profile:'melancholy'});
  }

  const regions=[...base,...inserts].sort((a,b)=>a.start-b.start);
  // Rebuild region ends from the now-complete start list. This is the key:
  // every inserted approach ends exactly when the next approach/target begins,
  // and the original target still sounds on its original structural step.
  for(let i=0;i<regions.length;i++){
    regions[i].end=(i+1<regions.length?regions[i+1].start:STEP_COUNT)-1;
  }
  return regions;
}
function makeCoolHarmonyMap(){
  // Profile 3 / Modal Cool: roots and chord colours are deliberately independent.
  // The key only transposes the Locrian-shaped ROOT pool; chord tones themselves
  // are not constrained to that scale. There is no functional-harmony NEXT table.
  const anchorCount=activeStepCount===64
    ? weighted([[5,5.5],[6,3.0]])
    : weighted([[2,3.0],[3,5.5],[4,1.2]]);
  const positionPools={
    2:[[0,1,2,3],[14,16,18]],
    3:[[0,1,2,3],[9,10,11,12],[20,21,22,23]],
    4:[[0,1,2,3],[7,8,9],[15,16,17],[23,24,25]],
    5:[[0,1,2,3],[7,8,9],[15,16,17],[23,24,25],Array.from({length:32},(_,i)=>33+i)],
    6:[[0,1,2,3],[7,8,9],[15,16,17],[23,24,25],Array.from({length:16},(_,i)=>33+i),[59,60,61,62,63]]
  };
  const starts=positionPools[anchorCount].map(pool=>choice(pool));
  const regions=[];
  for(let i=0;i<starts.length;i++){
    const start=starts[i];
    const end=(i+1<starts.length?starts[i+1]:STEP_COUNT)-1;
    const rootOffset=choice(COOL_ROOT_OFFSETS);
    const base=weighted(COOL_COLORS.map(c=>[c,c.w]));
    const color={
      name:`C${base.name}`,
      tones:base.intervals.map(interval=>(rootOffset+interval)%12),
      w:base.w,
      openChance:(base.name==='m11'||base.name==='9sus4')?.48:.32
    };
    regions.push({start,end,degree:null,rootOffset,color,profile:'cool'});
  }
  return regions;
}

function makeHarmonyMap(){
  // p10: 32 steps are only two bars. Treat harmony as a few large anchors,
  // not as a miniature chord-progression exercise. Most phrases get 2–3
  // unmistakable chord hits; 4 is deliberately uncommon.
  const anchorCount=activeStepCount===64
    ? weighted([[5,5.5],[6,3.0]])
    : weighted([[2,3.0],[3,5.5],[4,1.2]]);
  const positionPools={
    2:[[0,1,2,3],[14,16,18]],
    3:[[0,1,2,3],[9,10,11,12],[20,21,22,23]],
    4:[[0,1,2,3],[7,8,9],[15,16,17],[23,24,25]],
    5:[[0,1,2,3],[7,8,9],[15,16,17],[23,24,25],Array.from({length:32},(_,i)=>33+i)],
    6:[[0,1,2,3],[7,8,9],[15,16,17],[23,24,25],Array.from({length:16},(_,i)=>33+i),[59,60,61,62,63]]
  };
  const starts=positionPools[anchorCount].map(pool=>choice(pool));
  const regions=[];
  let degree=weighted([[0,1.5],[5,1.8],[2,1.5],[3,1.4],[1,1.0],[4,.8],[6,.15]]);
  for(let i=0;i<starts.length;i++){
    const start=starts[i];
    const end=(i+1<starts.length?starts[i+1]:STEP_COUNT)-1;
    const color=chooseColor(degree);
    regions.push({start,end,degree,color});
    if(i+1<starts.length) degree=weighted(NEXT[degree]);
  }
  return regions;
}
function regionAt(regions,step){return regions.find(r=>step>=r.start&&step<=r.end) ?? regions[0]}

function pitchCandidates(region, previousTop, chordOnly=false){
  const chord=regionPcs(region);
  const out=[];
  // Melo lives in a deliberately instrument-like register. Large root motion is
  // represented by inversions, not by throwing the whole chord up/down octaves.
  for(let midi=RANGE_MIN;midi<=RANGE_MAX;midi++){
    const pc=(midi-60+120)%12;
    const rootPc=transposePc(region.rootOffset ?? SCALE[region.degree]);
    // G2-B2 is the extension below the original C3 floor. Reserve it for
    // the current harmony root only, so accidental low non-root notes do not
    // imply unintended slash/on-chord harmony.
    if(midi<48 && pc!==rootPc) continue;
    const inChord=chord.includes(pc);
    if(region.profile==='cool'){
      if(!inChord && !coolRootPcs().includes(pc)) continue;
    }else if(region.profile==='melancholy'){
      if(!inChord && !scalePcs().includes(pc)) continue;
    }else if(!scalePcs().includes(pc)) continue;
    if(chordOnly && !inChord) continue;
    let w=inChord?10:.45;
    if(inChord){ const idx=chord.indexOf(pc); if(idx===1)w*=1.2; if(idx===3)w*=1.3; }
    // A single note is heard as melody, so make stepwise/third motion normal and
    // octave-sized leaps exceptional.
    if(previousTop!=null){
      const d=Math.abs(midi-previousTop);
      if(d===0)w*=1.15;
      else if(d<=2)w*=5.0;
      else if(d<=4)w*=3.2;
      else if(d<=7)w*=1.15;
      else if(d>=12)w*=.035;
      else if(d>=9)w*=.18;
    }
    if(midi<55)w*=.55;
    if(midi>77)w*=.72;
    out.push([midi,w]);
  }
  return out;
}
function pickPitch(region,previousTop,chordOnly=false){return weighted(pitchCandidates(region,previousTop,chordOnly))}

function unique(arr){return [...new Set(arr)].sort((a,b)=>a-b)}
function voiceDistance(a,b){
  if(!a?.length || !b?.length)return 0;
  // Match each new voice to the nearest old voice. This is deliberately not
  // root-position aware: common tones and small individual movements win.
  return b.reduce((sum,n)=>sum+Math.min(...a.map(p=>Math.abs(n-p))),0)/b.length;
}
function voicingCandidates(region,count){
  const pcs=regionPcs(region);
  const LOW_SPLIT=60; // C4: G2-B3 behaves as the bass register
  const notes=[];
  const rootPc=transposePc(region.rootOffset ?? SCALE[region.degree]);
  for(let midi=RANGE_MIN;midi<=RANGE_MAX;midi++){
    const pc=(midi-60+120)%12;
    // The added G2-B2 bass extension is root-only. C3 and above keep the
    // existing voicing freedom.
    if(midi<48 && pc!==rootPc) continue;
    if(pcs.includes(pc))notes.push(midi);
  }
  const out=[];
  function walk(from,chosen){
    if(chosen.length===count){
      const span=chosen.at(-1)-chosen[0];
      // Keep the low register clear: G2-B3 may contribute one bass voice,
      // but never a low cluster. Harmony/inner voices live from C4 upward.
      const lowVoices=chosen.filter(n=>n<LOW_SPLIT);
      if(lowVoices.length>1)return;
      if(lowVoices.length===1 && chosen.length>1 && chosen[1]<LOW_SPLIT)return;
      // Think small polyphonic instrument: a voicing normally fits inside about
      // an octave and a half. This is a voicing span, NOT a root-motion limit.
      if(span<=30)out.push([...chosen]);
      return;
    }
    for(let i=from;i<notes.length;i++){
      const n=notes[i];
      if(chosen.length && n-chosen[0]>30)break;
      // Avoid exact pitch-class duplication unless the selected colour has fewer
      // distinct tones than the requested voice count.
      const pc=(n-60+120)%12;
      const used=chosen.some(x=>(x-60+120)%12===pc);
      if(used && new Set(pcs).size>=count)continue;
      walk(i+1,[...chosen,n]);
    }
  }
  walk(0,[]);
  return out;
}
function buildChordVoicing(region, previousVoicing, previousTop, count, requiredPcs=[], openPreferred=false){
  let candidates=voicingCandidates(region,count);
  // A chromatic passing note only reads as an approach when it resolves into
  // the destination root in the bass. For those Profile 1 targets only, force
  // the target root to be the lowest voice; upper voices still use the normal
  // voice-leading scorer.
  if(region.forceRootBass){
    const rootPc=transposePc(region.rootOffset ?? SCALE[region.degree]);
    const rooted=candidates.filter(v=>v.length && ((v[0]-60+120)%12)===rootPc);
    if(rooted.length)candidates=rooted;
  }
  // At a harmony boundary, require at least one pitch-class that identifies the
  // new chord. This keeps voice leading from smoothing the progression away.
  if(requiredPcs.length){
    const identified=candidates.filter(v=>v.some(n=>requiredPcs.includes((n-60+120)%12)));
    if(identified.length)candidates=identified;
  }
  if(!candidates.length)return [];
  let best=candidates[0], bestScore=Infinity;
  for(const v of candidates){
    const top=v.at(-1);
    const topMove=previousTop==null?0:Math.abs(top-previousTop);
    const common=previousVoicing?.length ? v.filter(n=>previousVoicing.includes(n)).length : 0;
    const move=voiceDistance(previousVoicing,v);
    const center=v.reduce((a,b)=>a+b,0)/v.length;
    // Top note behaves like a melody. Inner voices prefer common tones / nearest
    // inversions. Randomness only breaks near-ties instead of defining voicing.
    let score=topMove*1.65 + move*1.55 - common*4.2 + Math.abs(center-65)*.035;
    // A generated anchor may ask for an open interpretation of the same chord.
    // Keep voice-leading in charge; this only biases the candidate ranking.
    const gaps=v.slice(1).map((n,i)=>n-v[i]);
    const span=v.at(-1)-v[0];
    const openness=span + gaps.filter(g=>g>=7).length*4;
    score += openPreferred ? -openness*.34 : openness*.10;
    // Keep ordinary motion smooth, but allow the top line to breathe across the
    // roughly 2.5-octave instrument range instead of hugging one register.
    if(topMove>9)score+=(topMove-9)*2.2;
    if(topMove>14)score+=18;
    score+=Math.random()*2.2;
    if(score<bestScore){bestScore=score;best=v;}
  }
  return best;
}

function octaveDisplaceSingle(note, previousTop, enabled){
  if(!enabled)return note;
  const alternatives=[note-12,note+12].filter(n=>n>=RANGE_MIN&&n<=RANGE_MAX);
  if(!alternatives.length)return note;
  // Prefer the octave that opens the phrase away from the previous top note.
  alternatives.sort((a,b)=>Math.abs(b-previousTop)-Math.abs(a-previousTop));
  return alternatives[0];
}

function makeEvent(region, context, step){
  const regionStart=step===region.start;

  // Profile 1 diminished approaches are intentionally *not* full diminished
  // chords. The chromatic root is the expressive information; sounding the
  // whole symmetric chord added unnecessary out-of-key upper voices.
  if(regionStart && region.chromaticPassing){
    const rootPc=transposePc(region.rootOffset);
    const note=nearestRootPitch(rootPc,context.voicing?.length?context.voicing:[context.top]);
    return {notes:[note],root:note,offsets:[0],display:'•',anchor:true,chromaticPassing:true};
  }

  // Profile 1 approach regions are chord anchors only. Do not let Default's
  // diatonic connector logic leak notes into borrowed/diminished harmony.
  if(!regionStart && region.noConnector)return null;

  // Harmony anchors are the structural events: make them clearly chordal.
  // Everything between them is only a sparse single-note connector.
  if(regionStart){
    const count=weighted([[3,5.0],[4,3.2],[2,.7]]);
    const previousPcs=context.region ? regionPcs(context.region) : [];
    const currentPcs=regionPcs(region);
    let identityPcs=currentPcs.filter(pc=>!previousPcs.includes(pc));
    if(!identityPcs.length) identityPcs=[currentPcs[0]];
    // Extended dominant colours lean open when the fixed instrument range allows
    // it. If a wide candidate cannot fit G2-F5, the ordinary compact candidates
    // remain available, so the colour survives while the voicing folds inward.
    const openChance=region.color.openChance ?? .25;
    const openVoicing=Math.random()<openChance;
    const characterPcs=(region.color.character ?? []).map(transposePc);
    const requiredPcs=characterPcs.length ? characterPcs : identityPcs;
    let notes=buildChordVoicing(region,context.voicing,context.top,count,requiredPcs,openVoicing);
    notes=unique(notes);
    if(!notes.length)return null;
    const root=notes[0];
    return {notes,root,offsets:notes.map(n=>n-root),display:String(notes.length),anchor:true,openVoicing};
  }

  // Two bars cannot carry much melodic information. Usually leave the space
  // empty; occasionally add one note that points from one harmonic anchor to
  // the next. Slightly favour offbeats so the chord hit remains perceptually
  // dominant.
  const local=step-region.start;
  const offbeat=(step%4!==0);
  const fillChance=offbeat?.15:.07;
  if(local<=1 || Math.random()>fillChance)return null;


  // Connector notes remain chord-aware but may use a diatonic passing tone.
  // The existing previous-top weighting keeps them phrase-like rather than
  // sounding as independent random notes.
  const chordOnly=region.profile==='cool' ? true : Math.random()<.68;
  const octaveDisplaced=Math.random()<.12;
  let note=pickPitch(region,context.top,chordOnly);
  note=octaveDisplaceSingle(note,context.top,octaveDisplaced);
  return {notes:[note],root:note,offsets:[0],display:'•',anchor:false,octaveDisplaced};
}
function nearestRootPitch(rootPc, anchorNotes){
  // Keep the optional root in the same musical register as the anchor rather
  // than turning it into a separate bass part.
  const center=anchorNotes?.length
    ? anchorNotes.reduce((sum,n)=>sum+n,0)/anchorNotes.length
    : 65;
  const candidates=[];
  for(let midi=RANGE_MIN;midi<=RANGE_MAX;midi++){
    if(((midi-60+120)%12)===rootPc)candidates.push(midi);
  }
  return candidates.reduce((best,n)=>
    Math.abs(n-center)<Math.abs(best-center)?n:best,
    candidates[0] ?? 60
  );
}

function addOptionalRootSupports(regions,events){
  // Profile 1: evaluate every sounding event, not only harmony anchors.
  // If that event does not contain the current harmony root, add the lowest
  // in-range root to a random empty step 1-3 steps away 80% of the time.
  // Work from a snapshot so newly-added supports do not themselves create more supports.
  const sourceEvents=[...events];
  for(let step=0;step<sourceEvents.length;step++){
    const ev=sourceEvents[step];
    if(!ev?.notes?.length)continue;
    const region=regionAt(regions,step);
    if(!region)continue;

    const melancholy=region.profile==='melancholy';
    if(melancholy){
      const rootPc=transposePc(region.color.tones[0]);
      const hasRoot=ev.notes.some(n=>((n-60+120)%12)===rootPc);
      // This also covers a one-note event that is itself the root: it needs no support.
      if(hasRoot || Math.random()>=.80)continue;

      const candidates=[];
      for(let distance=1;distance<=3;distance++){
        const before=step-distance;
        const after=step+distance;
        if(before>=0 && before<activeStepCount && !events[before])candidates.push(before);
        if(after>=0 && after<activeStepCount && !events[after])candidates.push(after);
      }
      if(!candidates.length)continue;
      const target=candidates[rand(candidates.length)];

      let note=null;
      for(let midi=RANGE_MIN;midi<=RANGE_MAX;midi++){
        if(((midi-60+120)%12)===rootPc){note=midi;break;}
      }
      if(note==null)note=nearestRootPitch(rootPc,ev.notes);
      events[target]={
        notes:[note],root:note,offsets:[0],display:'•',anchor:false,
        rootSupport:true,profile1RootSupport:true
      };
      continue;
    }

    // Profiles 0/3 retain the completed anchor-only behaviour.
    if(region.noRootSupport || !ev.anchor || step!==region.start)continue;
    const rootPc=transposePc(region.color.tones[0]);
    const hasRoot=ev.notes.some(n=>((n-60+120)%12)===rootPc);
    if(hasRoot)continue;
    let target=-1;
    for(let distance=1;distance<=5 && target<0;distance++){
      const after=region.start+distance;
      const before=region.start-distance;
      if(after<=region.end && !events[after])target=after;
      else if(before>=region.start && !events[before])target=before;
    }
    if(target<0)continue;
    const note=nearestRootPitch(rootPc,ev.notes);
    events[target]={notes:[note],root:note,offsets:[0],display:'•',anchor:false,rootSupport:true};
  }
}
function suppressRootSupportsNearRootedAnchors(regions,events){
  // Keep ordinary Root Support from crowding a nearby root-bearing anchor.
  // Within +/-3 steps, a support is removed when its note occupies the same
  // octave as the anchor's root. A different-octave root remains available as
  // melodic/voicing colour. Opening Root Support is a separate grammar rule
  // and is never removed here.
  const rootedAnchors=[];
  for(let step=0;step<events.length;step++){
    const ev=events[step];
    if(!ev?.anchor || !ev.notes?.length)continue;
    const region=regionAt(regions,step);
    if(!region)continue;
    const rootPc=transposePc(region.color.tones[0]);
    const rootNotes=ev.notes.filter(n=>((n-60+120)%12)===rootPc);
    if(rootNotes.length)rootedAnchors.push({step,rootNotes});
  }

  for(let step=0;step<events.length;step++){
    const ev=events[step];
    if(!ev?.rootSupport || ev.openingRootSupport || !ev.notes?.length)continue;
    const supportOctave=Math.floor(ev.notes[0]/12);
    const crowded=rootedAnchors.some(anchor=>
      Math.abs(anchor.step-step)<=3 &&
      anchor.rootNotes.some(note=>Math.floor(note/12)===supportOctave)
    );
    if(crowded)events[step]=null;
  }
}

function enforceOpeningRootRule(regions,events){
  // Opening grammar shared by every Melo profile:
  // - step 1 (index 0) must always sound something;
  // - the first harmony root must appear somewhere within steps 1-4;
  // - if the first anchor arrives after step 1, step 1 is the root support;
  // - if the first anchor is on step 1 but rootless, place the root on steps 2-4.
  const firstRegion=regions[0];
  if(!firstRegion)return;
  const openingEnd=Math.min(4,activeStepCount);
  const rootPc=transposePc(firstRegion.color.tones[0]);
  const hasRoot=ev=>ev?.notes?.some(n=>((n-60+120)%12)===rootPc);
  const anchorStep=firstRegion.start;
  const anchor=events[anchorStep];
  const makeRootSupport=target=>{
    const note=nearestRootPitch(rootPc,anchor?.notes ?? []);
    events[target]={
      notes:[note],root:note,offsets:[0],display:'•',anchor:false,
      rootSupport:true,openingRootSupport:true,
      ...(firstRegion.profile==='melancholy'?{profile1RootSupport:true}:{})
    };
  };

  // Delayed first anchor: step 1 must still sound, but do not duplicate the
  // harmony root when the delayed anchor already contains it. In that case,
  // step 1 becomes a non-root single note from the same harmonic vocabulary.
  // If the delayed anchor is rootless, step 1 remains the explicit root support.
  if(anchorStep>0){
    if(hasRoot(anchor)){
      const previousTop=anchor?.notes?.at(-1) ?? 67;
      const nonRootCandidates=pitchCandidates(firstRegion,previousTop,false)
        .filter(([midi])=>((midi-60+120)%12)!==rootPc);
      const note=nonRootCandidates.length ? weighted(nonRootCandidates) : null;
      if(note!=null){
        events[0]={notes:[note],root:note,offsets:[0],display:'•',anchor:false,openingLead:true};
      }else{
        // Defensive fallback: the current vocabularies always have non-root
        // candidates, but never leave step 1 silent if a future profile does not.
        makeRootSupport(0);
      }
    }else{
      makeRootSupport(0);
    }
    for(let step=1;step<openingEnd;step++){
      if(step===anchorStep)continue;
      if(hasRoot(events[step]))events[step]=null;
    }
    return;
  }

  // The first anchor is already on step 1, so the song always starts audibly.
  // If that anchor contains the root, it alone owns the opening root.
  if(hasRoot(anchor)){
    for(let step=1;step<openingEnd;step++){
      if(hasRoot(events[step]))events[step]=null;
    }
    return;
  }

  // Rootless anchor on step 1: guarantee one explicit root on steps 2-4.
  // Reuse an existing root-bearing event there when possible; otherwise place
  // a dedicated root support on an empty step.
  const existing=[];
  for(let step=1;step<openingEnd;step++){
    if(hasRoot(events[step]))existing.push(step);
  }
  if(existing.length){
    const keep=choice(existing);
    for(const step of existing){if(step!==keep)events[step]=null;}
    return;
  }

  const empty=[];
  for(let step=1;step<openingEnd;step++){
    if(!events[step])empty.push(step);
  }
  if(empty.length)makeRootSupport(choice(empty));
}
function generateMeloLegacy(){
  const regions=makeHarmonyMap(); const events=[];
  const context={top:67,voicing:null,region:null};
  for(let i=0;i<STEP_COUNT;i++){
    const region=regionAt(regions,i); const ev=makeEvent(region,context,i); events.push(ev);
    if(ev){
      context.top=ev.notes.at(-1);
      if(ev.notes.length>=2) context.voicing=ev.notes;
    }
    context.region=region;
  }
  // Rootless anchors get one nearby root-note support in the same register.
  // Placement is fixed for the generated pattern; playback probability is 60%
  // per loop, so the perceived harmony can shift without changing the anchor.
  addOptionalRootSupports(regions,events);
  suppressRootSupportsNearRootedAnchors(regions,events);
  enforceOpeningRootRule(regions,events);
  model={regions,events}; render();
}
function revoiceForCurrentKey(){
  if(!model)return;
  const oldEvents=model.events;
  const events=Array(STEP_COUNT).fill(null);
  const context={top:67,voicing:null,region:null};

  // Preserve the generated Harmony Map and every occupied step. Only pitches/
  // voicings are recalculated inside the fixed G2-F#5 instrument window.
  for(let i=0;i<STEP_COUNT;i++){
    const old=oldEvents[i];
    const region=regionAt(model.regions,i);
    if(!old){ context.region=region; continue; }
    if(old.rootSupport){ context.region=region; continue; }

    let ev;
    if(old.chromaticPassing){
      const rootPc=transposePc(region.rootOffset);
      const note=nearestRootPitch(rootPc,context.voicing?.length?context.voicing:[context.top]);
      ev={...old,notes:[note],root:note,offsets:[0]};
    }else if(old.anchor){
      const count=old.notes.length;
      const previousPcs=context.region ? regionPcs(context.region) : [];
      const currentPcs=regionPcs(region);
      let identityPcs=currentPcs.filter(pc=>!previousPcs.includes(pc));
      if(!identityPcs.length)identityPcs=[currentPcs[0]];
      const characterPcs=(region.color.character ?? []).map(transposePc);
      const requiredPcs=characterPcs.length ? characterPcs : identityPcs;
      const notes=unique(buildChordVoicing(region,context.voicing,context.top,count,requiredPcs,!!old.openVoicing));
      ev={...old,notes,root:notes[0],offsets:notes.map(n=>n-notes[0])};
    }else{
      let note=pickPitch(region,context.top,true);
      note=octaveDisplaceSingle(note,context.top,!!old.octaveDisplaced);
      ev={...old,notes:[note],root:note,offsets:[0]};
    }
    events[i]=ev;
    context.top=ev.notes.at(-1);
    if(ev.notes.length>=2)context.voicing=ev.notes;
    context.region=region;
  }

  // Root-support positions also stay fixed; retune them to the new key after
  // their anchor voicings are known.
  for(let i=0;i<STEP_COUNT;i++){
    const old=oldEvents[i];
    if(!old?.rootSupport)continue;
    const region=regionAt(model.regions,i);
    const anchor=events[region.start];
    const rootPc=transposePc(region.color.tones[0]);
    const note=nearestRootPitch(rootPc,anchor?.notes ?? []);
    events[i]={...old,notes:[note],root:note,offsets:[0]};
  }

  suppressRootSupportsNearRootedAnchors(model.regions,events);
  model.events=events;
  render();
}
let stepEditorIndex=null;
function isDiatonicMidi(midi){
  return SCALE.some(offset=>((keyRoot+offset)%12)===(midi%12));
}
function editorEventForStep(stepIndex){
  return model?.events?.[stepIndex] ?? null;
}
function setEditorNotes(stepIndex,notes){
  if(!model || stepIndex<0 || stepIndex>=activeStepCount)return false;
  const clean=unique(notes.map(Number).filter(Number.isFinite).map(Math.round).filter(n=>n>=RANGE_MIN&&n<=RANGE_MAX)).sort((a,b)=>a-b);
  if(!clean.length){model.events[stepIndex]=null;return true;}
  const old=model.events[stepIndex];
  model.events[stepIndex]={
    ...(old ?? {}),
    notes:clean,
    root:clean[0],
    offsets:clean.map(n=>n-clean[0]),
    manualEdit:true,
    anchor:old?.anchor ?? false,
    rootSupport:false,
    chromaticPassing:false,
    profile1RootSupport:false
  };
  return true;
}
async function previewEditorNote(midi){
  await initializeAudio();
  playSequenceStep({
    melodic:{soundId:'1',note:midi-60,chord:'off',gain:86,pan:0,probability:100,subPattern:-1,nudge:0,strum:0},
    rhythm:null
  },bank,0,{bpm:Math.max(40,Math.min(240,currentBpm())),ignoreProbability:true,
    allowPolyphonicOverlap:true,meloLongSustain:meloLong,meloEnvelopeMode:meloMode});
}
function toggleEditorNote(midi){
  if(stepEditorIndex==null)return;
  pushHistory();
  const current=[...(editorEventForStep(stepEditorIndex)?.notes ?? [])];
  const at=current.indexOf(midi);
  if(at>=0)current.splice(at,1);
  else{current.push(midi);previewEditorNote(midi).catch(console.error);}
  setEditorNotes(stepEditorIndex,current);
  render();
}
function shiftEditorNotes(direction){
  if(stepEditorIndex==null)return;
  const current=[...(editorEventForStep(stepEditorIndex)?.notes ?? [])];
  if(!current.length)return;
  const shifted=current.map(n=>n+direction);
  if(shifted.some(n=>n<RANGE_MIN||n>RANGE_MAX))return;
  pushHistory();
  setEditorNotes(stepEditorIndex,shifted);
  render();
}
function setEditorRhythm(soundId){
  if(stepEditorIndex==null)return;
  pushHistory();
  rhythmEvents[stepEditorIndex]=rhythmEvents[stepEditorIndex]===soundId?null:soundId;
  render();
}
function cycleEditorRhythmSubsteps(){
  if(stepEditorIndex==null)return;
  pushHistory();
  const current=rhythmSubsteps[stepEditorIndex] || 0;
  rhythmSubsteps[stepEditorIndex]=current===0?2:current===2?3:current===3?4:0;
  render();
}
function toggleEditorMeloSubsteps(){
  if(stepEditorIndex==null)return;
  pushHistory();
  meloSubsteps[stepEditorIndex]=!meloSubsteps[stepEditorIndex];
  render();
}
function moveStepEditor(direction){
  if(stepEditorIndex==null)return;
  const next=stepEditorIndex+direction;
  if(next<0||next>=activeStepCount)return;
  stepEditorIndex=next;
  renderStepEditor();
}
function showForceMark(ev){
  return !!ev && (ev.anchor ? ev.forceMarkVisible!==false : !!ev.forceSound);
}
function toggleEditorForceSound(){
  if(stepEditorIndex==null)return;
  const ev=editorEventForStep(stepEditorIndex);
  if(!ev)return;
  pushHistory();
  if(ev.anchor)ev.forceMarkVisible=!showForceMark(ev);
  else ev.forceSound=!ev.forceSound;
  render();
}
function openStepEditor(stepIndex){
  if(!Number.isInteger(stepIndex)||stepIndex<0||stepIndex>=activeStepCount)return;
  stepEditorIndex=stepIndex;
  renderStepEditor();
}
function closeStepEditor(){
  stepEditorIndex=null;
  document.querySelector('#step-editor')?.setAttribute('hidden','');
  document.querySelector('.sequence-area')?.classList.remove('editor-open');
}
function renderStepEditor(){
  const panel=document.querySelector('#step-editor');
  const sequenceArea=document.querySelector('.sequence-area');
  if(!panel||!sequenceArea)return;
  if(stepEditorIndex==null||stepEditorIndex>=activeStepCount){closeStepEditor();return;}
  sequenceArea.classList.add('editor-open');
  panel.removeAttribute('hidden');
  const ev=editorEventForStep(stepEditorIndex);
  const active=new Set(ev?.notes ?? []);
  const noteHost=panel.querySelector('.step-editor-notes');
  noteHost.innerHTML='';
  const editorRows=[];
  for(let rowStart=RANGE_MIN;rowStart<=RANGE_MAX;rowStart+=12){
    const row=[];
    for(let midi=rowStart;midi<=Math.min(rowStart+11,RANGE_MAX);midi++)row.push(midi);
    editorRows.push(row);
  }
  for(const row of editorRows.reverse()){
    for(const midi of row){
      const b=document.createElement('button');
      const name=NOTE_NAMES[midi%12];
      b.textContent=active.has(midi)?`[${name}]`:name;
      b.className='step-note';
      if(!isDiatonicMidi(midi))b.classList.add('off-key');
      if(active.has(midi))b.classList.add('active-note');
      b.dataset.midi=String(midi);
      b.addEventListener('click',()=>toggleEditorNote(midi));
      noteHost.append(b);
    }
  }
  panel.querySelector('.step-editor-index').textContent=String(stepEditorIndex+1).padStart(2,'0');
  panel.querySelector('.step-editor-force-mark').textContent=showForceMark(ev)?'’':'';
  const prevButton=panel.querySelector('#step-editor-prev');
  const nextButton=panel.querySelector('#step-editor-next');
  if(prevButton)prevButton.disabled=stepEditorIndex<=0;
  if(nextButton)nextButton.disabled=stepEditorIndex>=activeStepCount-1;
  const forceButton=panel.querySelector('#step-force-sound');
  if(forceButton){
    forceButton.textContent='’';
    forceButton.title='toggle guaranteed playback for this melodic step';
  }
  const currentRhythm=rhythmEvents[stepEditorIndex];
  panel.querySelectorAll('[data-rhythm]').forEach(b=>{
    const id=b.dataset.rhythm;
    b.textContent=currentRhythm===id?`[${RHYTHM_MARK[id]}]`:RHYTHM_MARK[id];
  });
  panel.querySelector('#step-rhythm-substeps').textContent='l'.repeat(rhythmSubsteps[stepEditorIndex] || 1);
  panel.querySelector('#step-melo-substeps').classList.toggle('is-on',meloSubsteps[stepEditorIndex]);
}
function render(){
  const keyEl=document.querySelector('#key-value'); if(keyEl)keyEl.textContent=KEY_NAMES[keyRoot];
  const grid=document.querySelector('#steps');grid.innerHTML='';
  for(let i=0;i<STEP_COUNT;i++){
    const ev=model?.events?.[i] ?? null;
    const soundId=rhythmEvents[i];
    const el=document.createElement('div'); el.className='step'; el.dataset.step=i;
    const m=document.createElement('span');m.className='melo';m.textContent=(i<activeStepCount&&ev)?String(ev.notes?.length||1):'';
    const mark=document.createElement('span');mark.className='force-mark';mark.textContent=(i<activeStepCount&&showForceMark(ev))?'’':'';
    const r=document.createElement('span');r.className='rhythm';r.textContent=(i<activeStepCount&&soundId)?RHYTHM_MARK[soundId]:'';
    const rhythmSubMark=document.createElement('span');rhythmSubMark.className='rhythm-sub-mark';
    rhythmSubMark.textContent=(i<activeStepCount&&soundId)?'.'.repeat(rhythmSubsteps[i] || 0):'';
    r.append(rhythmSubMark);
    const ph=document.createElement('span');ph.className='playhead';
    el.append(m,mark,r,ph);grid.append(el);
  }
  document.querySelector('#step-count').textContent=String(activeStepCount);
  document.querySelector('#swing').textContent=String(swing);
  updatePatternButtons();
  if(stepEditorIndex!=null)renderStepEditor();
  saveLatestState();
}
function clearVisuals(){visualTimers.forEach(clearTimeout);visualTimers=[];document.querySelectorAll('.step .playhead').forEach(x=>x.textContent='')}
function rotateEvents(source,amount){
  const n=((amount%activeStepCount)+activeStepCount)%activeStepCount;
  const out=source.slice();
  if(!n)return out;
  const active=source.slice(0,activeStepCount);
  for(let i=0;i<activeStepCount;i++) out[(i+n)%activeStepCount]=active[i];
  return out;
}
function shiftMelo(amount){
  model.events=rotateEvents(model.events,amount);
  meloSubsteps=rotateEvents(meloSubsteps,amount);
  render();
}
function shiftRhythm(amount){
  rhythmEvents=rotateEvents(rhythmEvents,amount);
  rhythmSubsteps=rotateEvents(rhythmSubsteps,amount);
  render();
}
function shuffled(source){
  const out=[...source];
  for(let i=out.length-1;i>0;i--){const j=rand(i+1);[out[i],out[j]]=[out[j],out[i]];}
  return out;
}
function placeRhythmIfEmpty(step,soundId){
  if(step>=0 && step<activeStepCount && !rhythmEvents[step])rhythmEvents[step]=soundId;
}
function decorateRhythmWindows(soundId,windowSize,minCount,maxCount){
  for(let start=0;start<activeStepCount;start+=windowSize){
    const end=Math.min(activeStepCount,start+windowSize);
    const empty=[];
    for(let step=start;step<end;step++)if(!rhythmEvents[step])empty.push(step);
    const count=Math.min(empty.length,minCount+rand(Math.max(1,maxCount-minCount+1)));
    for(const step of shuffled(empty).slice(0,count))rhythmEvents[step]=soundId;
  }
}
function generateStructuredRhythm(level,fourFloor=false){
  // User notation is 1-based. Internally every position below is zero-based.
  const dense=level>=5;
  const busiest=level>=6;
  const optional=(step,sound,chance)=>{if(step<activeStepCount && Math.random()<chance)rhythmEvents[step]=sound;};

  // 4: (k)000 s000 (k)0(k)0 s000
  // 5/6: (k)(k/s)00 s(k)(k)(s) (k)0(k)0 s00(k/s)
  for(let base=0;base<activeStepCount;base+=16){
    optional(base,'a',.58);
    if(dense)optional(base+1,Math.random()<.56?'a':'c',.52);
    placeRhythmIfEmpty(base+4,'c');
    if(dense){
      optional(base+5,'a',.46);
      optional(base+6,'a',.42);
      optional(base+7,'c',.38);
    }
    optional(base+8,'a',.48);
    optional(base+10,'a',.42);
    placeRhythmIfEmpty(base+12,'c');
    if(dense)optional(base+15,Math.random()<.52?'a':'c',.46);
  }

  // Opening kicks at steps 1 and 33 get a small extra bias.
  for(const step of [0,32]){
    if(step<activeStepCount && rhythmEvents[step]!=='a' && Math.random()<.28)rhythmEvents[step]='a';
  }

  if(busiest){
    // Raise snare activity on even-numbered user steps without turning it into a fixed grid.
    for(let step=1;step<activeStepCount;step+=2){
      if(!rhythmEvents[step] && Math.random()<.16)rhythmEvents[step]='c';
    }
  }

  if(fourFloor){
    // Quarter-note kick spine: 1,5,9...61. Usually kick, rarely another voice or a gap.
    for(let step=0;step<activeStepCount;step+=4){
      const r=Math.random();
      rhythmEvents[step]=r<.88?'a':r<.94?'c':r<.97?'b':r<.985?'d':null;
      // Slightly favour the step before each quarter kick for samba-like double kicks.
      const before=step-1;
      if(before>=0 && !rhythmEvents[before] && Math.random()<.18)rhythmEvents[before]='a';
    }
  }

  // Fill only currently empty cells, keeping the structural voices intact.
  if(level===4){
    decorateRhythmWindows('b',8,1,2);   // Hat: about 1-2 per 8 steps.
    decorateRhythmWindows('d',32,1,1);  // Perc: about 1 per 32 steps.
  }else if(level===5){
    decorateRhythmWindows('b',4,1,1);   // Hat: about 1 per 4 steps.
    decorateRhythmWindows('d',16,1,1);  // Perc: about 1 per 16 steps.
  }else{
    decorateRhythmWindows('b',4,2,2);   // Hat: about 2 per 4 steps.
    decorateRhythmWindows('d',16,1,1);  // Perc: about 1 per 16 steps.
  }

  if(level<5)return;

  const subCandidates=new Set();
  // Every eighth step is a light subdivision candidate.
  for(let userStep=8;userStep<=activeStepCount;userStep+=8){
    if(Math.random()<.34)subCandidates.add(userStep-1);
  }
  // End fills: steps 14-16 and, on 64-step patterns, 62-64.
  for(const userStep of [14,15,16,62,63,64]){
    if(userStep<=activeStepCount && Math.random()<.48)subCandidates.add(userStep-1);
  }

  for(const step of subCandidates){
    const sound=rhythmEvents[step];
    if(!sound)continue;
    if(level===5){
      if(sound==='a')continue; // Level 5 never subdivides Kick.
      rhythmSubsteps[step]=weighted([[2,1.25],[3,1]]);
    }else if(sound==='a'){
      // Kick may subdivide at level 6/9, but never beyond 32T.
      // Straight 32 and the 64-like four-hit feel are favoured over triplets;
      // 4 is retained here as the existing four-hit substep representation.
      rhythmSubsteps[step]=weighted([[2,1.5],[3,.55],[4,1.5]]);
    }else{
      rhythmSubsteps[step]=weighted([[2,1.15],[3,1],[4,1.05]]);
    }
  }
}
function generateRhythmLegacy(){
  rhythmEvents=Array(STEP_COUNT).fill(null);
  rhythmSubsteps=Array(STEP_COUNT).fill(0);
  if(rhythmDensity===0){render();return;}

  if(rhythmDensity<=3){
    const [minRatio,maxRatio]=RHYTHM_DENSITY_RANGES[rhythmDensity];
    const minHits=Math.ceil(activeStepCount*minRatio);
    const maxHits=Math.floor(activeStepCount*maxRatio);
    const hitCount=minHits+rand(Math.max(1,maxHits-minHits+1));
    const positions=shuffled(Array.from({length:activeStepCount},(_,i)=>i));
    for(const step of positions.slice(0,hitCount)){
      rhythmEvents[step]=weighted([['a',1],['b',1],['c',1],['d',1/3]]);
    }
  }else{
    const fourFloor=rhythmDensity>=7;
    const level=fourFloor?rhythmDensity-3:rhythmDensity;
    generateStructuredRhythm(level,fourFloor);
  }
  render();
}
// g01: first teacher-MIDI-derived chillgen engine (000-009).
// It deliberately reuses the existing harmony/voicing vocabulary for now; what
// changes here is the observed PERFORMANCE grammar: 4-note chord gestures are
// dominant, single-note answers are common, chord onsets are spread, durations
// are role-dependent, and the second half is usually an A -> A' mutation rather
// than a fresh random phrase.
function cloneGeneratedEvent(ev){return ev?{...ev,notes:[...(ev.notes??[])],offsets:[...(ev.offsets??[])]}:null;}
function teacherDurationSteps(role){
  if(role==='chord')return weighted([[2,2.0],[3,3.0],[4,2.4],[6,1.2],[8,.7],[12,.25],[16,.18]]);
  return weighted([[1,2.4],[2,4.2],[3,1.5],[4,.75],[6,.2]]);
}
function teacherStrumMs(){
  // 000-009 show intentional chord spreading; this is gesture, not tiny humanize.
  return weighted([[18,.8],[28,1.5],[42,2.1],[65,2.4],[90,1.8],[125,1.0],[165,.45]]);
}
function annotateTeacherPerformance(ev){
  if(!ev)return ev;
  const chord=(ev.notes?.length??0)>=2;
  // Keep timing per note: teacher MIDI does not use a single shared gate for a chord.
  ev.noteDurationSteps=(ev.notes??[]).map(()=>teacherDurationSteps(chord?'chord':'single'));
  ev.teacherDuration=true;
  if(chord){
    ev.strumMs=teacherStrumMs();
    ev.teacherSpread=true;
    // Preserve note order as a deliberate rolled/staggered gesture.
    ev.noteStartFractions=(ev.notes??[]).map((_,i,a)=>a.length<=1?0:i/(a.length-1));
  }
  return ev;
}
function nearestChordToneTo(region,target){
  const pcs=regionPcs(region); let best=null,bestD=Infinity;
  for(let n=Math.max(RANGE_MIN,target-7);n<=Math.min(RANGE_MAX,target+7);n++){
    if(!pcs.includes((n-60+120)%12))continue;
    const d=Math.abs(n-target); if(d<bestD){best=n;bestD=d;}
  }
  return best ?? Math.max(RANGE_MIN,Math.min(RANGE_MAX,target));
}
// g02: 20-loop teacher set (000-019). Single notes are phrase motion, not isolated picks.
const HIRO_G02_INTERVALS=[[2,20],[-2,17],[5,14],[-5,13],[7,12],[-7,8],[3,7],[-3,7],[4,6],[-4,5],[0,5],[9,2],[-9,2]];
const HIRO_G02_RUNS=[[1,5.0],[2,4.2],[3,2.2],[4,.7]];
function g02PhraseNote(region,context){
  if(!context.singleRunLeft){context.singleRunLeft=weighted(HIRO_G02_RUNS);context.singleDirection=Math.random()<.59?1:-1;}
  let interval=weighted(HIRO_G02_INTERVALS);
  if(interval!==0&&Math.random()<.68)interval=Math.abs(interval)*context.singleDirection;
  let note=nearestChordToneTo(region,context.top+interval);
  context.singleRunLeft=Math.max(0,context.singleRunLeft-1);
  if(context.singleRunLeft===0&&Math.random()<.45)context.singleDirection*=-1;
  return note;
}
// g03: teacher-derived harmony/voicing transitions from MIDI 000-019.
const HIRO_G03_CHORD_EDGES=[{"s":[0,3,10,14],"t":[2,5,10,17],"g":4,"w":1},{"s":[0,4,5,9],"t":[-3,-1,4,18],"g":1,"w":1},{"s":[0,7,11,14],"t":[5,7,16,19],"g":2,"w":1},{"s":[0,7,11,14],"t":[5,10,15,19],"g":2,"w":1},{"s":[0,5,10,14],"t":[0,3,10,14],"g":2,"w":1},{"s":[0,3,10,14],"t":[3,5,10],"g":2,"w":1},{"s":[0,3,7],"t":[-2,1,15],"g":1,"w":2},{"s":[0,4,7,11],"t":[-7,-3,4,9],"g":1,"w":3},{"s":[0,4,11,16],"t":[-2,2,9,12],"g":2,"w":1},{"s":[0,4,11,14],"t":[4,7,14,18],"g":3,"w":1},{"s":[0,3,10,14],"t":[-2,2,9,12],"g":1,"w":1},{"s":[0,7,11],"t":[0,6,11],"g":2,"w":2},{"s":[0,6,11],"t":[2,9,13],"g":1,"w":1},{"s":[0,7,11],"t":[2,5,12],"g":2,"w":1},{"s":[0,2,7,11],"t":[0,2,7,11,19],"g":1.75,"w":2},{"s":[0,2,7,11,19],"t":[-1,2,9,13],"g":0.5,"w":2},{"s":[0,3,10,14],"t":[-7,0,4,7],"g":1.75,"w":1},{"s":[0,3,10,14],"t":[-7,3,5],"g":2,"w":1},{"s":[0,2,7,11],"t":[-10,0,2,6],"g":2,"w":1},{"s":[0,2,7,11],"t":[-5,-2,5,9],"g":1,"w":1},{"s":[0,3,10,14],"t":[-3,0,7,11],"g":2,"w":1},{"s":[0,3,10,14],"t":[-4,-1,6,10],"g":2,"w":1},{"s":[0,3,10,14],"t":[-7,0,5,10],"g":2,"w":1},{"s":[0,3,10,14],"t":[-7,3,5,10],"g":1,"w":2},{"s":[0,3,10,14],"t":[5,9,14,17],"g":1,"w":1},{"s":[0,2,7,11],"t":[-3,4,8,11],"g":2,"w":1},{"s":[0,3,10,14],"t":[2,6,12,15],"g":1,"w":1},{"s":[0,4,11,14],"t":[-3,4,8,11],"g":2,"w":1},{"s":[0,4,11,14],"t":[-3,7,11,16],"g":2,"w":1},{"s":[0,3,10,14],"t":[-2,7,10,15],"g":1,"w":1},{"s":[0,4,11],"t":[2,6,12,16],"g":2,"w":1},{"s":[0,4,10,14],"t":[-7,4,7,9],"g":2,"w":1},{"s":[0,2,7,11],"t":[-1,2,7,9],"g":4,"w":1},{"s":[0,4,11],"t":[0,3,10],"g":3,"w":1},{"s":[0,2,7],"t":[-2,0,5],"g":2,"w":1}];
function g03Shape(notes){const b=Math.min(...notes);return [...notes].sort((a,b)=>a-b).map(n=>n-b);}
function g03ShapeDistance(a,b){let d=Math.abs(a.length-b.length)*7;const n=Math.min(a.length,b.length);for(let i=0;i<n;i++)d+=Math.abs(a[i]-b[i]);return d;}
function g03FitRange(notes){let a=[...notes].sort((x,y)=>x-y);while(a[0]<RANGE_MIN)a=a.map(n=>n+12);while(a.at(-1)>RANGE_MAX)a=a.map(n=>n-12);return a;}
function g03NextChord(notes){
 const shape=g03Shape(notes),bass=Math.min(...notes);
 const ranked=HIRO_G03_CHORD_EDGES.map(e=>[e,g03ShapeDistance(shape,e.s)]).sort((a,b)=>a[1]-b[1]);
 const best=ranked[0][1],pool=ranked.filter(x=>x[1]<=best+3).slice(0,12);
 const edge=weighted(pool.map(([e,d])=>[e,e.w/(1+d)]));
 return {notes:g03FitRange(edge.t.map(x=>bass+x)),gap:Math.max(2,Math.round(edge.g*4))};
}
// g04: preserve observed 3-chord harmonic context; singles follow the sounding chord, never the legacy harmony map.
const HIRO_G04_FRAGMENTS=[{"a":[0,7,11,14],"b":[5,7,16,19],"c":[3,10,14,17],"s1":8,"s2":10,"w":1},{"a":[0,7,11,14],"b":[5,10,15,19],"c":[5,8,15,19],"s1":8,"s2":8,"w":1},{"a":[0,2,7],"b":[0,2,6],"c":[-5,-3,2,6],"s1":4,"s2":4,"w":1},{"a":[0,12,14,19,23],"b":[6,9,16],"c":[5,12,14,19],"s1":8,"s2":4,"w":1},{"a":[0,3,10],"b":[-2,1,8],"c":[-4,1,6,10],"s1":4,"s2":4,"w":1},{"a":[0,3,10],"b":[-2,3,8,12],"c":[-3,2,7],"s1":4,"s2":8,"w":1},{"a":[0,5,10,14],"b":[-1,4,9],"c":[3,7,13,18],"s1":8,"s2":12,"w":1},{"a":[0,5,10,14],"b":[-1,1,6,10],"c":[3,5,10,14],"s1":8,"s2":4,"w":1},{"a":[0,3,10,14],"b":[-2,2,9,12],"c":[0,5,10,14],"s1":4,"s2":8,"w":1},{"a":[0,3,10,14],"b":[-7,3,5,10],"c":[-4,-1,6,10],"s1":4,"s2":4,"w":2},{"a":[0,3,10,14],"b":[5,9,14,17],"c":[2,7,12,16],"s1":4,"s2":8,"w":1},{"a":[0,4,11,14],"b":[-3,4,8,11],"c":[-5,2,7,11],"s1":8,"s2":4,"w":1},{"a":[0,4,11,14],"b":[-3,7,11,16],"c":[2,9,13,16],"s1":8,"s2":4,"w":1},{"a":[0,2,7,11],"b":[-3,4,8,11],"c":[-5,2,7,11],"s1":8,"s2":4,"w":1},{"a":[0,2,7,11],"b":[-5,-2,5,9],"c":[0,4,9,12],"s1":4,"s2":8,"w":1},{"a":[0,4,7,11],"b":[-7,-3,4,9],"c":[-5,2,5,9],"s1":4,"s2":8,"w":3},{"a":[0,4,11,16],"b":[-2,2,9,12],"c":[0,5,10,14],"s1":8,"s2":4,"w":1},{"a":[0,7,11],"b":[0,6,11],"c":[2,9,13],"s1":8,"s2":4,"w":2},{"a":[0,6,11],"b":[2,9,13],"c":[0,7,11],"s1":4,"s2":8,"w":1},{"a":[0,7,11],"b":[2,5,12],"c":[0,7,11],"s1":8,"s2":4,"w":1},{"a":[0,2,7,11],"b":[0,2,7,11,19],"c":[-1,2,9,13],"s1":7,"s2":2,"w":2},{"a":[0,3,10,14],"b":[-7,0,4,7],"c":[-5,2,5,9],"s1":7,"s2":4,"w":1},{"a":[0,2,7,11],"b":[-10,0,2,6],"c":[-8,-3,4,8],"s1":8,"s2":4,"w":1},{"a":[0,3,10,14],"b":[-3,0,7,11],"c":[-5,2,5,9],"s1":8,"s2":4,"w":1},{"a":[0,3,10,14],"b":[-4,-1,6,10],"c":[-7,0,5,10],"s1":8,"s2":4,"w":1},{"a":[0,3,10,14],"b":[-7,0,5,10],"c":[-7,3,5,10],"s1":8,"s2":4,"w":1},{"a":[0,3,10,14],"b":[-2,7,10,15],"c":[0,3,10,14],"s1":4,"s2":8,"w":1},{"a":[0,4,11],"b":[2,6,12,16],"c":[0,4,11,14],"s1":8,"s2":4,"w":1},{"a":[0,4,10,14],"b":[-7,4,7,9],"c":[-5,2,5,9],"s1":8,"s2":4,"w":1},{"a":[0,2,7,11],"b":[-1,2,7,9],"c":[-3,4,8,11],"s1":16,"s2":8,"w":1},{"a":[0,4,11],"b":[0,3,10],"c":[-2,5,9],"s1":12,"s2":8,"w":1},{"a":[0,2,7],"b":[-2,0,5],"c":[0,3,10],"s1":8,"s2":4,"w":1}];
function g04NearestPcNote(chordNotes,target){const pcs=[...new Set(chordNotes.map(n=>(n%12+12)%12))];let best=target,bestD=99;for(let n=Math.max(RANGE_MIN,target-8);n<=Math.min(RANGE_MAX,target+8);n++){if(!pcs.includes((n%12+12)%12))continue;const d=Math.abs(n-target);if(d<bestD){best=n;bestD=d;}}return best;}
function g04Single(chordNotes,context){if(!context.singleRunLeft){context.singleRunLeft=weighted(HIRO_G02_RUNS);context.singleDirection=Math.random()<.59?1:-1;}let interval=weighted(HIRO_G02_INTERVALS);if(interval&&Math.random()<.68)interval=Math.abs(interval)*context.singleDirection;let target=context.top+interval;let note=Math.random()<.82?g04NearestPcNote(chordNotes,target):Math.max(RANGE_MIN,Math.min(RANGE_MAX,target));context.singleRunLeft=Math.max(0,context.singleRunLeft-1);return note;}
// g05: intact teacher harmonic paths. No cross-song chord stitching.
const HIRO_G05_PATHS=[[[[0,7,11,14],8],[[0,5,10,14],8],[[0,3,10,14],7],[[0,22],1],[[0,2,7],4],[[0,2,6],4],[[0,2,7,11],5],[[0,4],2],[[0,10,14,15,29],9],[[0,12,14,19,23],8],[[0,3,10],4],[[0,7,9,14],8]],[[[0,4,7,11],4],[[0,4,11,16],8],[[0,3],1],[[0,4],11],[[0,4,7,11],4],[[0,4,11,16],4],[[0,4,7,11],4],[[0,4,11,16],8],[[0,4,11,14],12],[[0,3,10,14],4],[[0,4,11,14],8]],[[[0,2,7,11],7],[[0,2,7,11,19],2],[[0,3,10,14],7],[[0,7,11,14],7],[[0,3,5,10,15],4],[[0,3,7,15],5],[[0,2,7,11],7],[[0,2,7,11,19],2],[[0,3,10,14],7],[[0,7,11,14,28],7],[[0,3,5,10,21],4],[[0,3,7,15],8]],[[[0,4,7,12],8],[[0,2,4,9,16],4],[[0,7,8,15],4],[[0,7,10,17,22],4],[[0,2,7,11],4],[[0,3,10,14],8],[[0,3,5,13],8],[[0,2,7,14],4],[[0,7,8,15],4],[[0,7,10,17,29],4],[[0,2,7,16],4],[[0,6,9,15],8]],[[[0,3,10,14],4],[[0,10,12,17],4],[[0,3,10,14],4],[[0,4,9,12],2],[[0,2,7,11],8],[[0,7,11,14],10],[[0,3,10,14],4],[[0,10,12,17],4],[[0,3,10,14],4],[[0,4,10,13],2],[[0,4,11,14],8],[[0,7,11,14],8]],[[[0,4,11,14],8],[[0,10,14,19],8],[[0,7,10,19],8],[[0,3,10,14],4],[[0,9,12,17],4],[[0,4,11],8],[[0,4,10,14],8],[[0,11,14,16],8],[[0,9,14,19],4],[[0,2,7,11],8]]];
const HIRO_G07_VOICINGS=[...new Map(HIRO_G05_PATHS.flat().map(x=>[x[0].join(','),x[0]])).values()];
function g07Distance(a,b){const ap=a.map(n=>((n%12)+12)%12),bp=b.map(n=>((n%12)+12)%12);let common=ap.filter(x=>bp.includes(x)).length;const bass=Math.abs(a[0]-b[0]),top=Math.abs(a[a.length-1]-b[b.length-1]);return bass*.35+top*.22-common*1.4+Math.abs(a.length-b.length)*.6;}
function g07Next(prev,bass){const pool=HIRO_G07_VOICINGS.map(v=>g03FitRange(v.map(n=>bass+n)));if(!prev)return choice(pool);const ranked=pool.map(v=>[v,g07Distance(prev,v)+Math.random()*4]).sort((a,b)=>a[1]-b[1]);return choice(ranked.slice(0,Math.min(12,ranked.length)).map(x=>x[0]));}
const HIRO_G09_SEQS=[[[0,3,10,14],[2,5,10,17]],[[0,4,5,9],[-3,-1,4,18],[3,20],[-1,4,9,11],[0,2],[7,11],[-2,2,3,7]],[[0,7,11,14],[5,7,16,19],[3,10,14,17],[7,10]],[[0,7,11,14],[5,10,15,19],[5,8,15,19],[-2,20],[8,10,15],[8,10,14],[3,5,10,14],[19,23],[-3,7,11,12,26],[-4,8,10,15,19],[2,5,12],[1,8,10,15]],[[0,3,10],[2,6],[10,15],[3,6,13],[1,4,11],[-1,4,9,13],[-2,3,8],[2,6,12,17]],[[0,5,10,14],[-1,1,6],[-2,1,5],[-4,-1,13],[6,10],[0,5,10,14],[-1,1,6,18],[-2,1,5],[-4,-1,13],[6,10]],[[0,4,7,11],[-7,-3,4,9],[-10,-7],[0,4],[0,4,7,11],[-7,-3,4,9],[0,4,7,11],[-7,-3,4,9],[-9,-5,2,5],[-5,-2,5,9],[-7,-3,4,7]],[[0,4,11,14,23],[-1,7,9,14],[-3,4,7,14,23],[-1,6,9,16,21],[0,4,11,14,23],[-1,7,9,14,21],[-3,4,7,14],[-1,3,9,14]],[[0,7,11],[0,6,11],[2,9,13],[2,8,13],[0,7,11],[0,6,11,21],[-5,23],[2,9,13],[4,7,14]],[[0,2,7,11],[0,2,7,11,19],[-1,2,9,13],[-8,-1,3,6],[-3,0,2,7,12],[-1,2,6,14],[0,2,7,11],[0,2,7,11,19],[-1,2,9,13],[-8,-1,3,6,20],[-3,0,2,7,18],[-1,2,6,14]],[[0,3,10,14],[5,10],[-7,3,5],[-5,-2,0],[-7,3,5,10],[-2,9,17],[3,5,10,14],[-7,3,5,9],[-2,0,7,10],[-7,3,5,9],[-2,2,10]],[[0,4,7,12],[-7,-5,-3,2,9],[-15,-8,-7,0],[-17,-10,-7,0,5],[-7,-5,0,4],[-12,-9,-2,2],[-3,0,2,10],[-7,-5,0,7],[-15,-8,-7,0],[-17,-10,-7,0,12],[-7,-5,0,9],[-11,-5,-2,4]],[[0,4,11],[-3,4,7,11],[2,7,9,14],[6,19],[0,4,7,11],[2,7,9,14],[-2,5,9],[0,7,11],[6,23]],[[0,3,10,14],[-3,0,7,11],[-7,-4,3,7],[-9,-2,2],[-6,-2],[1,5],[-9,-2],[2,5],[3,10]],[[0,3,10,14],[-7,0,5,10],[9,14],[-7,3,5,10],[-9,-2,2,5,9],[0,3,10,14],[-10,0,6,10],[9,14],[-5,2,5,9],[-12,0,2,10],[7,12]],[[0,4],[-7,7],[-4,0],[2,6],[1,5],[-7,-3],[-4,7],[2,5],[-8,6],[-8,7]],[[0,3,10,14],[-7,3,5,10],[-4,-1,6,10],[1,5,10,13],[-6,-4,1,5],[-9,-2,2,5],[0,3,10,14],[-7,3,5,10],[-4,-1,6,10],[-2,2,8,11],[-6,-2,5,8],[-9,-2,2,5]],[[0,4,11,14],[-3,7,11,16],[-1,6,9,18],[4,7,14,18],[2,11,14,19],[0,4,11],[2,6,12,16],[-5,6,9,11],[2,11,16,21],[7,9,14,18]],[[0,2,7,11],[-1,2,7,9],[-2,19],[0,5,9],[7,14]],[[0,4,11],[0,3,10],[-3,4,7,16],[5,7,12],[3,5,10]]];
function g09Norm(c){const b=Math.min(...c);return c.slice().sort((a,b)=>a-b).map(n=>n-b);}
function g09Key(a,b){return g09Norm(a).join('.')+'>'+g09Norm(b).join('.')+'@'+(Math.min(...b)-Math.min(...a));}
const HIRO_G09_TRIPLES=(()=>{const m=new Map();for(const s of HIRO_G09_SEQS)for(let i=2;i<s.length;i++){const k=g09Key(s[i-2],s[i-1]);if(!m.has(k))m.set(k,[]);m.get(k).push({shape:g09Norm(s[i]),bassDelta:Math.min(...s[i])-Math.min(...s[i-1])});}return m;})();
function generateMeloG09(){const events=Array(STEP_COUNT).fill(null),regions=makeHarmonyMap();const seeds=HIRO_G09_SEQS.filter(s=>s.length>=3),src=choice(seeds),j=Math.floor(Math.random()*(src.length-2));let bass=48+keyRoot;while(bass<53)bass+=12;while(bass>59)bass-=12;const srcBase=Math.min(...src[j]);let prev=src[j].map(n=>bass+n-srcBase),cur=src[j+1].map(n=>bass+n-srcBase),at=0;const put=n=>{events[at]=annotateTeacherPerformance({notes:g03FitRange(n),root:Math.min(...n),offsets:n.map(x=>x-Math.min(...n)),display:String(n.length),anchor:true,teacherGesture:'g09-trigram'});};put(prev);at+=weighted([[4,4],[8,5],[2,1],[6,1]]);if(at<activeStepCount)put(cur);while(at<activeStepCount){const pool=HIRO_G09_TRIPLES.get(g09Key(prev,cur));if(!pool?.length)break;const nx=choice(pool),cb=Math.min(...cur),next=g03FitRange(nx.shape.map(x=>cb+nx.bassDelta+x));prev=cur;cur=next;at+=weighted([[4,4],[8,5],[2,1],[6,1]]);if(at<activeStepCount)put(cur);}model={regions,events};let next=-1;for(let i=activeStepCount-1;i>=0;i--){if(events[i]?.notes?.length>1){if(next>i){const d=Math.max(1,next-i-1);events[i].noteDurationSteps=events[i].notes.map(()=>d);events[i].teacherDuration=true;}next=i;}}render();}
function g10PcFit(chords,tonic,minor=false){const base=minor?[0,2,3,5,7,8,10]:[0,2,4,5,7,9,11],sc=new Set(base.map(x=>(x+tonic)%12));let hit=0,total=0;for(const c of chords){for(const n of c){total++;if(sc.has((n%12+12)%12))hit++;}}return total?hit/total:0;}
function g10BestCenter(chords){let best={score:-1,tonic:0,minor:false};for(let t=0;t<12;t++)for(const m of [false,true]){const score=g10PcFit(chords,t,m);if(score>best.score)best={score,tonic:t,minor:m};}return best;}
const HIRO_G10_CONTEXTS=(()=>{const m=new Map();for(const s of HIRO_G09_SEQS)for(let i=2;i<s.length;i++){const k=g09Key(s[i-2],s[i-1]);if(!m.has(k))m.set(k,[]);m.get(k).push({c:s[i],future:s.slice(i,Math.min(s.length,i+3))});}return m;})();
function g10Choose(prev,cur,history){const pool=HIRO_G10_CONTEXTS.get(g09Key(prev,cur));if(!pool?.length)return null;const home=g10BestCenter(history.slice(-3));let scored=pool.map(x=>{const stay=g10PcFit(x.future,home.tonic,home.minor);const dest=g10BestCenter(x.future);const settled=dest.score>=.82?dest.score:0;const same=dest.tonic===home.tonic&&dest.minor===home.minor;let score=Math.max(stay,settled)+(same?.10:0);if(!same&&settled<.82)score-=.35;return [x,score];});const max=Math.max(...scored.map(x=>x[1]));const good=scored.filter(x=>x[1]>=max-.08).map(x=>x[0]);return choice(good);}
function generateMeloG10(){const events=Array(STEP_COUNT).fill(null),regions=makeHarmonyMap();const seeds=HIRO_G09_SEQS.filter(s=>s.length>=3),src=choice(seeds),j=Math.floor(Math.random()*(src.length-2));let bass=48+keyRoot;while(bass<53)bass+=12;while(bass>59)bass-=12;const sb=Math.min(...src[j]);let prev=g03FitRange(src[j].map(n=>bass+n-sb)),cur=g03FitRange(src[j+1].map(n=>bass+n-sb)),history=[prev,cur],at=0;const put=n=>{events[at]=annotateTeacherPerformance({notes:[...n],root:Math.min(...n),offsets:n.map(x=>x-Math.min(...n)),display:String(n.length),anchor:true,teacherGesture:'g10-theory'});};put(prev);at+=weighted([[4,4],[8,5],[2,1],[6,1]]);if(at<activeStepCount)put(cur);while(at<activeStepCount){const pick=g10Choose(prev,cur,history);if(!pick)break;const source=pick.c,cb=Math.min(...cur),sourcePrevCandidates=[];for(const seq of HIRO_G09_SEQS)for(let i=2;i<seq.length;i++)if(seq[i]===source)sourcePrevCandidates.push(seq[i-1]);let bassDelta=0;if(sourcePrevCandidates.length)bassDelta=Math.min(...source)-Math.min(...sourcePrevCandidates[0]);else bassDelta=Math.min(...source)-Math.min(...cur);const next=g03FitRange(g09Norm(source).map(x=>cb+bassDelta+x));prev=cur;cur=next;history.push(cur);at+=weighted([[4,4],[8,5],[2,1],[6,1]]);if(at<activeStepCount)put(cur);}model={regions,events};let next=-1;for(let i=activeStepCount-1;i>=0;i--){if(events[i]?.notes?.length>1){if(next>i){const d=Math.max(1,next-i-1);events[i].noteDurationSteps=events[i].notes.map(()=>d);events[i].teacherDuration=true;}next=i;}}render();}
function g11FourVoices(notes){let a=[...new Set(notes)].sort((x,y)=>x-y);if(a.length>4){const bass=a[0],top=a.at(-1),middle=a.slice(1,-1);while(middle.length>2)middle.splice(Math.floor(middle.length/2),1);a=[bass,...middle,top];}while(a.length<4){const bass=a[0],top=a.at(-1);const candidates=[];for(const n of a){for(const d of [-12,12]){const x=n+d;if(x>=RANGE_MIN&&x<=RANGE_MAX&&!a.includes(x))candidates.push(x);}}if(candidates.length)a.push(candidates.sort((x,y)=>Math.abs(x-(bass+12))-Math.abs(y-(bass+12)))[0]);else{const x=Math.min(RANGE_MAX,top+12);if(!a.includes(x))a.push(x);else break;}a.sort((x,y)=>x-y);}return g03FitRange(a.slice(0,4));}
function generateMeloG11(){generateMeloG10();for(const ev of model.events){if(!ev?.notes||ev.notes.length<2)continue;ev.notes=g11FourVoices(ev.notes);ev.root=ev.notes[0];ev.offsets=ev.notes.map(n=>n-ev.root);ev.display='4';ev.noteDurationSteps=ev.notes.map(()=>ev.noteDurationSteps?.[0]??4);ev.teacherGesture='g11-fourvoice';}render();}

// g15: Raw-MIDI 4->single->4 gesture grammar.
// Each template keeps pitch relation, onset gap, per-note Note Off and chord spread together.
// Templates connect only when the outgoing 4-note shape exactly matches another teacher template's incoming shape.
const HIRO_G15_GESTURES=[{"l":"002","a":[0,7,11,14],"s":23,"c":[5,7,16,19],"gs":2,"gc":8,"da":[7,7,7,7],"ds":2,"dc":[7,7,7,7],"oa":[0,0.392,0.609,0.805],"oc":[0,0.392,0.402,0.076]},{"l":"006","a":[0,4,7,11],"s":14,"c":[-7,-3,4,9],"gs":3,"gc":4,"da":[3,3,3,3],"ds":1,"dc":[3,3,3,3],"oa":[0,0.294,0.326,0.717],"oc":[0,0.229,0.425,0.684]},{"l":"006","a":[0,4,11,16],"s":19,"c":[7,11,14,18],"gs":3,"gc":4,"da":[3,3,3,3],"ds":1,"dc":[3,3,3,3],"oa":[0,0.229,0.425,0.684],"oc":[0,0.294,0.326,0.717]},{"l":"006","a":[0,4,11,16],"s":19,"c":[-2,2,9,12],"gs":3,"gc":8,"da":[3,3,3,3],"ds":1,"dc":[3,3,3,6],"oa":[0,0.229,0.425,0.684],"oc":[0,0.356,0.521,0.786]},{"l":"006","a":[0,4,11,14],"s":11,"c":[4,7,14,18],"gs":6,"gc":12,"da":[3,3,3,6],"ds":2,"dc":[3,3,3,3],"oa":[0,0.356,0.521,0.786],"oc":[0,0.451,0.413,0.588]},{"l":"006","a":[0,3,10,14],"s":17,"c":[-2,2,9,12],"gs":3,"gc":4,"da":[3,3,3,3],"ds":1,"dc":[3,3,3,3],"oa":[0,0.451,0.413,0.588],"oc":[0,0.229,0.425,0.684]},{"l":"009","a":[0,3,7,15],"s":8,"c":[1,3,8,12],"gs":1,"gc":5,"da":[4,4,4,1],"ds":4,"dc":[3,3,3,3],"oa":[0,0.205,0.423,0],"oc":[0,0.239,0.331,0.536]},{"l":"010","a":[0,2,7,11],"s":7,"c":[-10,0,2,6],"gs":4,"gc":8,"da":[8,8,3,4],"ds":4,"dc":[8,4,3,4],"oa":[0,0.195,0.291,0.434],"oc":[0,0.271,0.671,0.792]},{"l":"010","a":[0,10,12,16],"s":12,"c":[5,7,14,17],"gs":5,"gc":8,"da":[8,4,3,4],"ds":3,"dc":[8,7,7,4],"oa":[0,0.271,0.671,0.792],"oc":[0,0.126,0.232,0.026]},{"l":"010","a":[0,2,9,12],"s":14,"c":[-5,5,7,11],"gs":4,"gc":8,"da":[8,7,7,4],"ds":4,"dc":[4,4,4,4],"oa":[0,0.126,0.232,0.026],"oc":[0,0.071,0.143,0.248]},{"l":"011","a":[0,2,7,11],"s":12,"c":[-5,-2,5,9],"gs":3,"gc":4,"da":[3,3,3,3],"ds":1,"dc":[4,3,3,3],"oa":[0,0.177,0.161,0.177],"oc":[0,0.225,0.369,0.418]},{"l":"011","a":[0,2,7,14],"s":23,"c":[-8,-1,0,7],"gs":2,"gc":4,"da":[3,3,3,1],"ds":1,"dc":[3,3,3,3],"oa":[0,0.129,0.354,0],"oc":[0,0.289,0.338,0.177]},{"l":"011","a":[0,2,7,16],"s":19,"c":[-4,2,5,11],"gs":3,"gc":4,"da":[3,3,3,3],"ds":1,"dc":[4,3,3,3],"oa":[0,0.177,0.161,0.273],"oc":[0,0.289,0.369,0.529]},{"l":"013","a":[0,3,10,14],"s":15,"c":[-4,-1,6,10],"gs":6,"gc":8,"da":[7,7,7,7],"ds":2,"dc":[8,8,8,8],"oa":[0,0.478,0.489,0.619],"oc":[0,0.294,0.555,0.815]},{"l":"014","a":[0,3,10,14],"s":17,"c":[-7,0,5,10],"gs":3,"gc":8,"da":[7,7,7,7],"ds":1,"dc":[7,7,7,7],"oa":[0,0.293,0.642,0.381],"oc":[0,0.349,0.619,0.543]},{"l":"014","a":[0,3,10,14],"s":17,"c":[-10,0,6,10],"gs":3,"gc":8,"da":[7,7,7,7],"ds":1,"dc":[7,7,7,7],"oa":[0,0.293,0.642,0.381],"oc":[0,0.37,0.576,0.564]},{"l":"016","a":[0,3,10,14],"s":12,"c":[-7,3,5,10],"gs":2,"gc":4,"da":[2,2,2,2],"ds":1,"dc":[2,2,2,2],"oa":[0,0.064,0.11,0.121],"oc":[0,0.074,0.046,0.065]},{"l":"016","a":[0,10,12,17],"s":12,"c":[3,6,13,17],"gs":3,"gc":4,"da":[2,2,2,2],"ds":1,"dc":[2,2,2,2],"oa":[0,0.074,0.046,0.065],"oc":[0,0.027,0.064,0.065]},{"l":"016","a":[0,3,10,14],"s":12,"c":[5,9,14,17],"gs":2,"gc":4,"da":[2,2,2,2],"ds":1,"dc":[1,1,1,1],"oa":[0,0.027,0.064,0.065],"oc":[0,0.11,0.129,0.167]},{"l":"016","a":[0,3,10,14],"s":12,"c":[2,6,12,15],"gs":2,"gc":4,"da":[2,2,2,2],"ds":1,"dc":[1,1,1,2],"oa":[0,0.027,0.064,0.065],"oc":[0,0.157,0.22,0.271]}];
function g15Shape(notes){const b=Math.min(...notes);return [...notes].sort((a,b)=>a-b).map(n=>n-b).join(',');}
function g15SetPerformance(ev,durations,onsetOffsets=[]){
  ev.noteDurationSteps=[...durations];ev.teacherDuration=true;
  if(ev.notes.length>1){
    const max=Math.max(0,...onsetOffsets);
    ev.teacherSpread=true;
    ev.strumMs=max*(60000/currentBpm()/4);
    ev.noteStartFractions=max?onsetOffsets.map(x=>x/max):onsetOffsets.map(()=>0);
  }
  return ev;
}
function g15Make(notes,durations,onsetOffsets,tag){
  const ev=annotateTeacherPerformance({notes:[...notes],root:Math.min(...notes),offsets:notes.map(n=>n-Math.min(...notes)),display:notes.length===1?'•':String(notes.length),anchor:notes.length>1,teacherGesture:tag});
  return g15SetPerformance(ev,durations,onsetOffsets);
}
function generateMeloG15(){
  const events=Array(STEP_COUNT).fill(null),regions=makeHarmonyMap();
  const chainable=HIRO_G15_GESTURES.filter(g=>HIRO_G15_GESTURES.some(h=>g15Shape(g.c)===g15Shape(h.a)));
  let g=choice(chainable.length?chainable:HIRO_G15_GESTURES);
  let bass=48+keyRoot;while(bass<53)bass+=12;while(bass>59)bass-=12;
  let at=0,guard=0;
  while(g&&at<activeStepCount&&guard++<16){
    const all=[...g.a,g.s,...g.c].map(n=>bass+n);let shift=0;
    while(Math.min(...all)+shift<RANGE_MIN)shift+=12;
    while(Math.max(...all)+shift>RANGE_MAX)shift-=12;
    bass+=shift;
    const a=g.a.map(n=>bass+n),single=bass+g.s,c=g.c.map(n=>bass+n);
    // The anchor's outgoing duration/spread belongs to this exact source gesture.
    events[at]=g15Make(a,g.da,g.oa,'g15-4s4:'+g.l);
    const sAt=at+g.gs,cAt=at+g.gc;
    if(sAt<activeStepCount)events[sAt]=g15Make([single],[g.ds],[0],'g15-4s4:'+g.l);
    if(cAt>=activeStepCount)break;
    events[cAt]=g15Make(c,g.dc,g.oc,'g15-4s4:'+g.l);
    const outShape=g15Shape(c);
    const pool=HIRO_G15_GESTURES.filter(h=>g15Shape(h.a)===outShape);
    if(!pool.length)break;
    const next=choice(pool);
    // Re-anchor the next teacher gesture on the exact current 4-note shape.
    at=cAt;bass=Math.min(...c);g=next;
  }
  model={regions,events};render();
}

const HIRO_G14_RUNS=(()=>{const runs=[];for(const seq of HIRO_G09_SEQS){let run=[];for(const c of seq){if(c.length===4)run.push(c);else{if(run.length>=3)runs.push(run);run=[];}}if(run.length>=3)runs.push(run);}return runs;})();
const HIRO_G14_CONTEXTS=(()=>{const m=new Map();for(const s of HIRO_G14_RUNS)for(let i=2;i<s.length;i++){const k=g09Key(s[i-2],s[i-1]);if(!m.has(k))m.set(k,[]);m.get(k).push({c:s[i],db:Math.min(...s[i])-Math.min(...s[i-1])});}return m;})();
function generateMeloG14(){const events=Array(STEP_COUNT).fill(null),regions=makeHarmonyMap();const src=choice(HIRO_G14_RUNS),j=Math.floor(Math.random()*(src.length-2));let bass=48+keyRoot;while(bass<53)bass+=12;while(bass>59)bass-=12;const sb=Math.min(...src[j]);let prev=g03FitRange(src[j].map(n=>bass+n-sb)),cur=g03FitRange(src[j+1].map(n=>bass+n-sb)),at=0;const put=n=>{events[at]=annotateTeacherPerformance({notes:[...n],root:Math.min(...n),offsets:n.map(x=>x-Math.min(...n)),display:'4',anchor:true,teacherGesture:'g14-adjacent4'});};put(prev);at+=weighted([[4,4],[8,5],[2,1],[6,1]]);if(at<activeStepCount)put(cur);while(at<activeStepCount){const pool=HIRO_G14_CONTEXTS.get(g09Key(prev,cur));if(!pool?.length)break;const pick=choice(pool),cb=Math.min(...cur),next=g03FitRange(g09Norm(pick.c).map(x=>cb+pick.db+x));prev=cur;cur=next;at+=weighted([[4,4],[8,5],[2,1],[6,1]]);if(at<activeStepCount)put(cur);}model={regions,events};let next=-1;for(let i=activeStepCount-1;i>=0;i--){if(events[i]?.notes?.length===4){if(next>i){const d=Math.max(1,next-i-1);events[i].noteDurationSteps=events[i].notes.map(()=>d);events[i].teacherDuration=true;}next=i;}}render();}
const HIRO_G12_SEQS=HIRO_G09_SEQS.map(seq=>seq.filter(c=>c.length===4)).filter(seq=>seq.length>=3);
const HIRO_G12_CONTEXTS=(()=>{const m=new Map();for(const s of HIRO_G12_SEQS)for(let i=2;i<s.length;i++){const k=g09Key(s[i-2],s[i-1]);if(!m.has(k))m.set(k,[]);m.get(k).push(s[i]);}return m;})();
function generateMeloG12(){const events=Array(STEP_COUNT).fill(null),regions=makeHarmonyMap();const src=choice(HIRO_G12_SEQS),j=Math.floor(Math.random()*(src.length-2));let bass=48+keyRoot;while(bass<53)bass+=12;while(bass>59)bass-=12;const sb=Math.min(...src[j]);let prev=g03FitRange(src[j].map(n=>bass+n-sb)),cur=g03FitRange(src[j+1].map(n=>bass+n-sb)),at=0;const put=n=>{events[at]=annotateTeacherPerformance({notes:[...n],root:Math.min(...n),offsets:n.map(x=>x-Math.min(...n)),display:'4',anchor:true,teacherGesture:'g12-native4'});};put(prev);at+=weighted([[4,4],[8,5],[2,1],[6,1]]);if(at<activeStepCount)put(cur);while(at<activeStepCount){const pool=HIRO_G12_CONTEXTS.get(g09Key(prev,cur));if(!pool?.length)break;const source=choice(pool),cb=Math.min(...cur);let bassDelta=null;outer:for(const seq of HIRO_G12_SEQS)for(let i=2;i<seq.length;i++)if(seq[i]===source&&g09Key(seq[i-2],seq[i-1])===g09Key(prev,cur)){bassDelta=Math.min(...seq[i])-Math.min(...seq[i-1]);break outer;}if(bassDelta===null)break;const next=g03FitRange(g09Norm(source).map(x=>cb+bassDelta+x));prev=cur;cur=next;at+=weighted([[4,4],[8,5],[2,1],[6,1]]);if(at<activeStepCount)put(cur);}model={regions,events};let next=-1;for(let i=activeStepCount-1;i>=0;i--){if(events[i]?.notes?.length===4){if(next>i){const d=Math.max(1,next-i-1);events[i].noteDurationSteps=events[i].notes.map(()=>d);events[i].teacherDuration=true;}next=i;}}render();}
function g08EdgeFrom(notes){const shape=g03Shape(notes),bass=Math.min(...notes);let pool=HIRO_G03_CHORD_EDGES.filter(e=>g03ShapeDistance(shape,e.s)===0);if(!pool.length){const scored=HIRO_G03_CHORD_EDGES.map(e=>[e,g03ShapeDistance(shape,e.s)]).sort((a,b)=>a[1]-b[1]);const best=scored[0][1];pool=scored.filter(x=>x[1]===best).map(x=>x[0]);}const e=weighted(pool.map(x=>[x,x.w||1]));return {notes:g03FitRange(e.t.map(x=>bass+x)),gap:Math.max(2,Math.round(e.g*4))};}
function generateMeloG08(){const events=Array(STEP_COUNT).fill(null),regions=makeHarmonyMap();let bass=48+keyRoot;while(bass<53)bass+=12;while(bass>59)bass-=12;const seed=choice(HIRO_G03_CHORD_EDGES),first=g03FitRange(seed.s.map(x=>bass+x));let notes=first,at=0;while(at<activeStepCount){events[at]=annotateTeacherPerformance({notes:[...notes],root:notes[0],offsets:notes.map(n=>n-notes[0]),display:String(notes.length),anchor:true,teacherGesture:'g08-edge'});const nx=g08EdgeFrom(notes);at+=nx.gap;notes=nx.notes;}const context={top:events.find(Boolean)?.notes?.at(-1)??67,singleRunLeft:0,singleDirection:1};let sounding=null,last=-1;for(let i=0;i<activeStepCount;i++){if(events[i]){sounding=events[i].notes;last=i;context.top=sounding.at(-1);continue;}if(sounding&&i-last>=2&&Math.random()<(i%4?.10:.02)){const note=g04Single(sounding,context);events[i]=annotateTeacherPerformance({notes:[note],root:note,offsets:[0],display:'•',anchor:false,teacherGesture:'g08-answer'});context.top=note;}}model={regions,events};let next=-1;for(let i=activeStepCount-1;i>=0;i--){if(events[i]?.notes?.length>1){if(next>i){const d=Math.max(1,next-i-1);events[i].noteDurationSteps=events[i].notes.map(()=>d);events[i].teacherDuration=true;}next=i;}}render();}
function generateMeloG07(){const events=Array(STEP_COUNT).fill(null),regions=makeHarmonyMap();let at=0,prev=null,bass=48+keyRoot;while(bass<53)bass+=12;while(bass>59)bass-=12;while(at<activeStepCount){const move=prev?weighted([[-7,1],[-5,2],[-2,2],[0,1],[2,2],[5,2],[7,1]]):0;bass=Math.max(48,Math.min(62,bass+move));const notes=g07Next(prev,bass);events[at]=annotateTeacherPerformance({notes:[...notes],root:notes[0],offsets:notes.map(n=>n-notes[0]),display:String(notes.length),anchor:true,teacherGesture:'g07'});prev=notes;at+=weighted([[4,4],[8,5],[2,1],[6,1],[12,.5]]);}const context={top:events.find(Boolean)?.notes?.at(-1)??67,singleRunLeft:0,singleDirection:1};let sounding=null,last=-1;for(let i=0;i<activeStepCount;i++){if(events[i]){sounding=events[i].notes;last=i;context.top=sounding.at(-1);continue;}if(sounding&&i-last>=2&&Math.random()<(i%4?.11:.025)){const note=g04Single(sounding,context);events[i]=annotateTeacherPerformance({notes:[note],root:note,offsets:[0],display:'•',anchor:false,teacherGesture:'g07-answer'});context.top=note;}}model={regions,events};let next=-1;for(let i=activeStepCount-1;i>=0;i--){if(events[i]?.notes?.length>1){if(next>i){const d=Math.max(1,next-i-1);events[i].noteDurationSteps=events[i].notes.map(()=>d);events[i].teacherDuration=true;}next=i;}}render();}
function generateMeloG06(){generateMeloG05();const e=model.events;let next=-1;for(let i=activeStepCount-1;i>=0;i--){if(e[i]&&e[i].notes&&e[i].notes.length>1){if(next>i){const d=Math.max(1,next-i-1);e[i].noteDurationSteps=e[i].notes.map(()=>d);e[i].teacherDuration=true;}next=i;}}render();}
function generateMeloG05(){
 const events=Array(STEP_COUNT).fill(null),regions=makeHarmonyMap();const path=choice(HIRO_G05_PATHS);let at=0;
 let bass=48+keyRoot;while(bass<53)bass+=12;while(bass>59)bass-=12;
 for(let cycle=0;at<activeStepCount;cycle++){
  const start=(cycle===0?rand(Math.max(1,path.length-4)):0);
  for(let j=start;j<path.length&&at<activeStepCount;j++){
   const [shape,gap]=path[j];const notes=g03FitRange(shape.map(n=>bass+n));
   events[at]=annotateTeacherPerformance({notes:[...notes],root:notes[0],offsets:notes.map(n=>n-notes[0]),display:String(notes.length),anchor:true,teacherGesture:'g05-path'});
   at+=Math.max(1,gap);
  }
 }
 // Singles hear only the actual sounding chord. Non-chord passing tones are rare and stepwise.
 const context={top:events.find(Boolean)?.notes?.at(-1)??67,singleRunLeft:0,singleDirection:1};let sounding=null,lastChordAt=-1;
 for(let i=0;i<activeStepCount;i++){
  if(events[i]){sounding=events[i].notes;lastChordAt=i;context.top=sounding.at(-1);context.singleRunLeft=0;continue;}
  if(!sounding||i-lastChordAt<2)continue;
  if(Math.random()<(i%4!==0?.13:.035)){
   let note=g04Single(sounding,context);
   if(Math.random()<.12){const step=choice([-2,-1,1,2]);note=Math.max(RANGE_MIN,Math.min(RANGE_MAX,note+step));}
   events[i]=annotateTeacherPerformance({notes:[note],root:note,offsets:[0],display:'•',anchor:false,teacherGesture:'g05-answer'});context.top=note;
  }
 }
 model={regions,events};render();
}
function generateMeloG04(){
 const events=Array(STEP_COUNT).fill(null),regions=makeHarmonyMap(); let at=0;
 let bass=48+keyRoot;while(bass<53)bass+=12;while(bass>59)bass-=12;
 let previous=null;
 while(at<activeStepCount){
   let pool=HIRO_G04_FRAGMENTS;
   if(previous){const shape=g03Shape(previous);const ranked=pool.map(f=>[f,g03ShapeDistance(shape,f.a)]).sort((x,y)=>x[1]-y[1]);const d=ranked[0][1];pool=ranked.filter(x=>x[1]<=d+2).slice(0,10).map(x=>x[0]);}
   const f=weighted(pool.map(x=>[x,x.w||1]));
   const base=previous?Math.min(...previous):bass;
   const chords=[f.a,f.b,f.c].map(rel=>g03FitRange(rel.map(n=>base+n)));
   const positions=[at,at+f.s1,at+f.s1+f.s2];
   for(let j=0;j<3;j++){const p=positions[j];if(p>=activeStepCount)break;const notes=chords[j];events[p]=annotateTeacherPerformance({notes:[...notes],root:notes[0],offsets:notes.map(n=>n-notes[0]),display:String(notes.length),anchor:true,teacherGesture:'g04-context'});previous=notes;}
   at=positions[2]+weighted([[4,2],[8,1]]);
 }
 // Single answers use the actual sounding g04 chord pitch classes.
 const context={top:events.find(Boolean)?.notes?.at(-1)??67,singleRunLeft:0,singleDirection:1};let sounding=null,lastChordAt=-1;
 for(let i=0;i<activeStepCount;i++){
   if(events[i]){sounding=events[i].notes;lastChordAt=i;context.top=events[i].notes.at(-1);context.singleRunLeft=0;continue;}
   if(!sounding||i-lastChordAt<2)continue;
   if(Math.random()<(i%4!==0?.15:.05)){const note=g04Single(sounding,context);events[i]=annotateTeacherPerformance({notes:[note],root:note,offsets:[0],display:'•',anchor:false,teacherGesture:'g04-answer'});context.top=note;}
 }
 model={regions,events};render();
}
function generateMeloG03(){
 const events=Array(STEP_COUNT).fill(null), regions=makeHarmonyMap();
 const starts=[[0,3,10,14],[0,2,7,11],[0,7,11],[0,7,11,14],[0,5,10,14],[0,4,7,11],[0,4,11,14],[0,4,11]];
 let bass=48+keyRoot;while(bass<53)bass+=12;while(bass>59)bass-=12;
 let notes=g03FitRange(choice(starts).map(x=>bass+x)); let at=0;
 while(at<activeStepCount){
   events[at]=annotateTeacherPerformance({notes:[...notes],root:notes[0],offsets:notes.map(n=>n-notes[0]),display:String(notes.length),anchor:true,teacherGesture:'g03-chord'});
   const next=g03NextChord(notes); at+=next.gap; notes=next.notes;
 }
 // Put teacher-style single answers into some of the real spaces between chord gestures.
 const context={top:events[0]?.notes?.at(-1)??67,singleRunLeft:0,singleDirection:1};
 for(let i=1;i<activeStepCount;i++){
   if(events[i]){context.top=events[i].notes.at(-1);context.singleRunLeft=0;continue;}
   const prev=events.slice(0,i).reverse().find(Boolean), next=events.slice(i+1,activeStepCount).find(Boolean);
   if(!prev||!next)continue;
   const distPrev=i-events.lastIndexOf(prev); const offbeat=i%4!==0;
   if(distPrev>=2&&Math.random()<(offbeat?.16:.055)){
     const region=regionAt(regions,i); const note=g02PhraseNote(region,context);
     events[i]=annotateTeacherPerformance({notes:[note],root:note,offsets:[0],display:'•',anchor:false,teacherGesture:'g03-answer'});context.top=note;
   }
 }
 model={regions,events};render();
}
function generateMeloG01(){
  const regions=makeHarmonyMap();
  const events=Array(STEP_COUNT).fill(null);
  const phraseLength=Math.min(32,activeStepCount); // two bars = compositional unit
  const context={top:67,voicing:null,region:null};

  // First half: chord gesture -> space/answer -> next chord gesture.
  for(let i=0;i<phraseLength;i++){
    const region=regionAt(regions,i);
    let ev=null;
    if(i===region.start){
      const count=weighted([[4,5.4],[5,1.7],[3,1.6],[2,.45]]);
      const prevPcs=context.region?regionPcs(context.region):[];
      const currentPcs=regionPcs(region);
      let identity=currentPcs.filter(pc=>!prevPcs.includes(pc));
      if(!identity.length)identity=[currentPcs[0]];
      let notes=unique(buildChordVoicing(region,context.voicing,context.top,count,identity,Math.random()<.30));
      if(notes.length){
        ev=annotateTeacherPerformance({notes,root:notes[0],offsets:notes.map(n=>n-notes[0]),display:String(notes.length),anchor:true,teacherGesture:'chord'});
      }
    }else{
      const since=i-region.start;
      const offbeat=i%4!==0;
      // Teacher set frequently answers held harmony with sparse upper singles.
      const chance=since>1?(offbeat?.23:.10):.035;
      if(Math.random()<chance){
        let note=g02PhraseNote(region,context);
        ev=annotateTeacherPerformance({notes:[note],root:note,offsets:[0],display:'•',anchor:false,teacherGesture:'answer'});
      }
    }
    events[i]=ev;
    if(ev){context.top=ev.notes.at(-1);if(ev.notes.length>=2){context.voicing=ev.notes;context.singleRunLeft=0;}}
    context.region=region;
  }

  // A -> A': preserve most of the two-bar performance skeleton. Mutate only a
  // handful of events, matching the strong second-half reuse seen in 005/007/009.
  if(activeStepCount>phraseLength){
    const second=Math.min(phraseLength,activeStepCount-phraseLength);
    for(let i=0;i<second;i++)events[phraseLength+i]=cloneGeneratedEvent(events[i]);
    const occupied=Array.from({length:second},(_,i)=>i).filter(i=>events[phraseLength+i]);
    const mutationCount=Math.max(1,Math.round(occupied.length*weighted([[.12,3.5],[.20,2.2],[.32,.8]])));
    for(const i of shuffled(occupied).slice(0,mutationCount)){
      const at=phraseLength+i; const old=events[at]; const region=regionAt(regions,at);
      if(!old)continue;
      if(old.notes.length===1){
        const note=nearestChordToneTo(region,old.notes[0]+choice([-3,-2,2,3,4]));
        events[at]=annotateTeacherPerformance({...old,notes:[note],root:note,offsets:[0],teacherVariation:true});
      }else{
        const count=old.notes.length;
        const notes=unique(buildChordVoicing(region,old.notes,old.notes.at(-1),count,[],Math.random()<.35));
        if(notes.length)events[at]=annotateTeacherPerformance({...old,notes,root:notes[0],offsets:notes.map(n=>n-notes[0]),teacherVariation:true});
      }
    }
    // Small end-of-phrase addition: common A' behaviour in the teacher loops.
    if(Math.random()<.62){
      const empties=[]; for(let i=Math.max(phraseLength,activeStepCount-8);i<activeStepCount;i++)if(!events[i])empties.push(i);
      if(empties.length){const at=choice(empties),region=regionAt(regions,at),base=events.slice(phraseLength,at).reverse().find(Boolean)?.notes?.at(-1)??67;
        const note=nearestChordToneTo(region,base+choice([-2,2,3]));
        events[at]=annotateTeacherPerformance({notes:[note],root:note,offsets:[0],display:'•',anchor:false,teacherGesture:'ending-variation'});
      }
    }
  }
  model={regions,events}; render();
}
function generateRhythmG01(){
  // First pass intentionally stays conservative until MIDI note 2/4/6 ->
  // kick/hat/snare identity is verified. Use the existing known sample mapping,
  // but create an A -> A' drum skeleton rather than inventing teacher labels.
  rhythmEvents=Array(STEP_COUNT).fill(null); rhythmSubsteps=Array(STEP_COUNT).fill(0);
  const half=Math.min(32,activeStepCount);
  for(let base=0;base<half;base+=16){
    if(Math.random()<.88)rhythmEvents[base]='a';
    rhythmEvents[base+4]='c';
    if(Math.random()<.55)rhythmEvents[base+8]='a';
    rhythmEvents[base+12]='c';
    for(const p of [2,6,10,14])if(base+p<half&&Math.random()<.55)rhythmEvents[base+p]='b';
    for(const p of [3,7,11,15])if(base+p<half&&Math.random()<.18&&!rhythmEvents[base+p])rhythmEvents[base+p]='a';
  }
  if(activeStepCount>half){
    const second=Math.min(half,activeStepCount-half);
    for(let i=0;i<second;i++)rhythmEvents[half+i]=rhythmEvents[i];
    for(let n=0;n<Math.max(1,Math.round(second/16));n++){
      const at=half+rand(second);
      if(rhythmEvents[at]&&Math.random()<.5)rhythmEvents[at]=null;
      else if(!rhythmEvents[at])rhythmEvents[at]=weighted([['a',1],['b',1.2],['c',.7]]);
    }
  }
  render();
}
function generateMelo(){return generateMeloG12();}
function generateRhythm(){return generateRhythmG01();}

function setRhythmDensity(value){
  rhythmDensity=Math.max(0,Math.min(9,Math.round(value)));
  const el=document.querySelector('#rhythm-density');
  if(el)el.textContent=String(rhythmDensity);
}
function updateMuteButtons(){
  updateMeloControls();
  const m=document.querySelector('#melo-mute');
  const r=document.querySelector('#rhythm-mute');
  m?.classList.toggle('active',melodicMuted);
  r?.classList.toggle('active',rhythmMuted);
  if(m)m.textContent=melodicMuted?'[M]':'M';
  if(r)r.textContent=rhythmMuted?'[M]':'M';
  document.querySelector('#steps')?.classList.toggle('melo-muted',melodicMuted);
  document.querySelector('#steps')?.classList.toggle('rhythm-muted',rhythmMuted);
}
function scheduleLiveStep(token, stepIndex, targetMs){
  if(token!==runToken || !playing)return;

  const bpm=Math.max(40,Math.min(240,currentBpm()));
  const stepSeconds=60/bpm/4;
  const stepMs=stepSeconds*1000;
  // Shift every offbeat 16th as one unit. ±5 approaches one 32nd-note offset
  // while leaving a tiny guard so adjacent step boundaries never coincide.
  const swingOffsetSec=(stepIndex%2===1)?(stepSeconds*.49)*(swing/5):0;
  const delaySec=Math.max(0,(targetMs-performance.now())/1000+swingOffsetSec);
  const ev=model.events[stepIndex];
  const soundId=rhythmEvents[stepIndex];

  document.querySelectorAll('.step .playhead').forEach(x=>x.textContent='');
  const ph=document.querySelector(`.step[data-step="${stepIndex}"] .playhead`); if(ph)ph.textContent='=';

  // Read the current step data only when that step is about to sound. Generate,
  // Shift, Sort and Key therefore replace data under a running playhead without
  // resetting its position.
  // Profile 1 diminished passing notes are intentionally light: even though
  // they are structural approach events, sound them on only ~30% of loops.
  // Anchors default to guaranteed playback; removing their mark makes them 60%.
  // Root-support notes remain guaranteed once generated; ordinary non-anchors stay at 60%.
  const meloShouldSound=ev && (
    ev.chromaticPassing ? Math.random()<0.30 :
    ((ev.anchor ? showForceMark(ev) : ev.forceSound || ev.profile1RootSupport) || Math.random()<0.60)
  );
  const subNotes=ev?.notes?.length>=1 && ev.notes.length<=4 && meloSubsteps[stepIndex]
    ? [...ev.notes].sort((a,b)=>a-b) : null;
  if(subNotes?.length===4){
    // At the last step, look ahead to the start of the queued pattern if available.
    const nextIndex=(stepIndex+1)%activeStepCount;
    const queued=nextIndex===0 && queuedPattern!==null && queuedPattern!==selectedPattern
      ? patternSlots[queuedPattern-1]?.model?.events?.[0] : null;
    const nextEvent=queued || model.events[nextIndex];
    const nextLowest=nextEvent?.notes?.length?Math.min(...nextEvent.notes):null;
    if(nextLowest!==null && nextLowest<subNotes[3])subNotes.reverse();
  }
  if((meloLong || meloMode===2) && ev && !melodicMuted){
    for(const note of [...heldMelo.keys()]){
      if(heldMelo.get(note)<=targetMs+1)heldMelo.delete(note);
    }
  }
  if(!melodicMuted && meloShouldSound){
    if(subNotes){
      // One-note: 64th note / rest / 64th note / rest. Every onset is independent.
      // Two/three/four notes: sequential 32nds / 32nd triplets / 64ths.
      const count=subNotes.length;
      const slices=count===1?4:count;
      const noteGate=stepSeconds/slices;
      const sequence=count===1?[subNotes[0],null,subNotes[0],null]:subNotes;
      for(let slice=0;slice<sequence.length;slice++){
        const note=sequence[slice];
        if(note===null)continue;
        playSequenceStep({
          melodic:{soundId:'1',note:note-60,chord:'off',gain:count>=3?70:86,pan:0,probability:100,subPattern:-1,nudge:0,strum:0},
          rhythm:null
        },bank,delaySec+slice*noteGate,{bpm,ignoreProbability:true,gateSecondsOverride:noteGate,
          allowPolyphonicOverlap:true,meloLongSustain:false,meloEnvelopeMode:meloMode});
      }
      // Do not retain any substep pitch for the normal-note tie mechanism.
      for(const note of subNotes)heldMelo.delete(note);
    }else{
      for(let noteIndex=0;noteIndex<ev.notes.length;noteIndex++){
        const note=ev.notes[noteIndex];
        const teacherTimed=Boolean(ev.teacherDuration);
        if(!teacherTimed && (meloLong || meloMode===2) && (heldMelo.get(note)||0)>targetMs+1)continue;
        const noteSteps=teacherTimed
          ? Math.max(.25,Number(ev.noteDurationSteps?.[noteIndex] ?? ev.durationSteps ?? 1))
          : (meloMode===2?Math.min(6,heldNoteSteps(note,stepIndex)):(meloLong?heldNoteSteps(note,stepIndex):1));
        if(!teacherTimed && (meloLong || meloMode===2))heldMelo.set(note,targetMs+noteSteps*stepMs);
        const spreadSec=ev.teacherSpread
          ? (Math.max(0,Number(ev.strumMs)||0)/1000)*Number(ev.noteStartFractions?.[noteIndex] ?? (ev.notes.length<=1?0:noteIndex/(ev.notes.length-1)))
          : 0;
        playSequenceStep({
          melodic:{soundId:'1',note:note-60,chord:'off',gain:ev.notes.length>=3?70:86,pan:0,probability:100,subPattern:-1,nudge:0,strum:0},
          rhythm:null
        },bank,delaySec+spreadSec,{bpm,ignoreProbability:true,gateSecondsOverride:stepSeconds*noteSteps,
          teacherGate:teacherTimed,
          allowPolyphonicOverlap:true,meloLongSustain:teacherTimed?false:meloLong,meloEnvelopeMode:teacherTimed?0:meloMode});
      }
    }
  }

  if(!rhythmMuted && soundId){
    const hitCount=[2,3,4].includes(rhythmSubsteps[stepIndex])?rhythmSubsteps[stepIndex]:1;
    for(let hit=0;hit<hitCount;hit++){
      playSequenceStep({
        melodic:null,
        rhythm:{soundId,note:0,gain:hitCount===1?100:50,pan:0,probability:100,subPattern:-1,subProbability:100,nudge:0}
      },bank,delaySec+hit*stepSeconds/hitCount,{bpm,ignoreProbability:true});
    }
  }

  const nextIndex=(stepIndex+1)%activeStepCount;
  const nextTarget=targetMs+stepMs;
  const finishedCycle=nextIndex===0;
  // Negative swing needs the offbeat to be scheduled before its nominal grid time.
  // Look ahead far enough for the maximum 49% early shift, plus the normal 35 ms scheduler margin.
  const nextSwingOffsetMs=(nextIndex%2===1)?(stepMs*.49)*(swing/5):0;
  const lookaheadMs=35+Math.max(0,-nextSwingOffsetMs);
  const wait=Math.max(0,nextTarget-performance.now()-lookaheadMs);

  visualTimers.push(setTimeout(()=>{
    if(token!==runToken || !playing)return;
    if(finishedCycle && !loopEnabled){
      playing=false;
      queuedPattern=null;updatePatternButtons();
      heldMelo.clear();
      document.querySelector('#play').textContent='>';
      clearVisuals();
      return;
    }
    if(finishedCycle && queuedPattern!==null && queuedPattern!==selectedPattern){
      const nextPattern=queuedPattern;
      selectPatternSlot(nextPattern);
      heldMelo.clear();
    }
    scheduleLiveStep(token,0===nextIndex?0:nextIndex,nextTarget);
  },wait));
}
async function play({resetAudio=true}={}){
  const token=++runToken;
  playing=true;
  queuedPattern=null;updatePatternButtons();
  heldMelo.clear();
  clearVisuals();
  document.querySelector('#play').textContent='[>]';
  if(resetAudio) await resetAudioForForegroundPlayback();
  await initializeAudio(); setMasterVolume(.7);
  if(token!==runToken || !playing)return;
  scheduleLiveStep(token,0,performance.now()+35);
}
async function stop(){
  queuedPattern=null;updatePatternButtons();
  ++runToken; playing=false; heldMelo.clear(); clearVisuals(); document.querySelector('#play').textContent='>';
  await resetAudioForForegroundPlayback();
}
function editWhilePlaying(mutator){
  // Editing never touches runToken, the audio clock or the playhead. Only the
  // pattern data is replaced, so the next unsounded step uses the new result.
  mutator();
}
function sortAllSteps(){
  pushHistory();
  const steps=Array.from({length:activeStepCount},(_,i)=>({melo:model.events[i],rhythm:rhythmEvents[i],substeps:rhythmSubsteps[i],meloSub:meloSubsteps[i]}));
  for(let i=steps.length-1;i>0;i--){const j=rand(i+1);[steps[i],steps[j]]=[steps[j],steps[i]];}
  for(let i=0;i<activeStepCount;i++){model.events[i]=steps[i].melo;rhythmEvents[i]=steps[i].rhythm;rhythmSubsteps[i]=steps[i].substeps;meloSubsteps[i]=steps[i].meloSub;}
  render();
}
function doubleCopySteps(){
  if(activeStepCount>=STEP_COUNT)return;
  pushHistory();
  const sourceLength=activeStepCount;
  const copyLength=Math.min(sourceLength,STEP_COUNT-sourceLength);
  for(let i=0;i<copyLength;i++){
    model.events[sourceLength+i]=structuredClone(model.events[i] ?? null);
    rhythmEvents[sourceLength+i]=rhythmEvents[i] ?? null;
    rhythmSubsteps[sourceLength+i]=rhythmSubsteps[i] || 0;
    meloSubsteps[sourceLength+i]=!!meloSubsteps[i];
  }
  activeStepCount=Math.min(STEP_COUNT,sourceLength*2);
  render();
}
function snapshot(){return structuredClone({model,rhythmEvents,rhythmSubsteps,meloSubsteps,keyRoot,rhythmDensity,melodicMuted,rhythmMuted,activeStepCount,meloLong,meloMode,beat});}
function saveLatestState(){
  if(projectStoreReady) projectStore.markChanged();
  try{
    localStorage.setItem(LATEST_STATE_KEY,JSON.stringify({
      version:1,
      current:snapshot(),
      patternSlots:structuredClone(patternSlots),
      selectedPattern,bpm,swing,loopEnabled,paletteIndex,songTitle
    }));
  }catch(error){console.warn('latest state save failed',error);}
}
function restoreLatestState(){
  try{
    const raw=localStorage.getItem(LATEST_STATE_KEY);
    if(!raw)return false;
    const data=JSON.parse(raw);
    if(!data?.current?.model)return false;
    ({model,rhythmEvents,keyRoot,rhythmDensity,melodicMuted,rhythmMuted,activeStepCount,meloLong=false,beat=0}=structuredClone(data.current));
    swing=Math.max(-5,Math.min(5,Number(data.swing ?? data.current.swing) || 0));
    meloMode=Number.isInteger(data.current.meloMode)?Math.max(0,Math.min(3,data.current.meloMode)):(meloLong?1:0);
    meloLong=meloMode===1;
    rhythmSubsteps=Array.from({length:STEP_COUNT},(_,i)=>[2,3,4].includes(data.current.rhythmSubsteps?.[i])?data.current.rhythmSubsteps[i]:0);
    meloSubsteps=Array.from({length:STEP_COUNT},(_,i)=>!!data.current.meloSubsteps?.[i]);
    if(Array.isArray(data.patternSlots)){
      for(let i=0;i<patternSlots.length;i++)patternSlots[i]=structuredClone(data.patternSlots[i] ?? null);
    }
    selectedPattern=Math.max(1,Math.min(patternSlots.length,Number(data.selectedPattern)||1));
    bpm=Math.max(40,Math.min(240,Number(data.bpm)||105));
    loopEnabled=Boolean(data.loopEnabled);
    songTitle=typeof data.songTitle === 'string' && data.songTitle.trim() ? data.songTitle.trim().slice(0,80) : 'untitled';
    updateSongTitle();
    paletteIndex=Math.max(0,Math.min(5,Number(data.paletteIndex)||0));
    document.body.className=paletteIndex?`palette-${paletteIndex}`:'';
    document.querySelector('#loop').textContent=loopEnabled?'[L]':'L';
    setBpm(bpm);setRhythmDensity(rhythmDensity);updateMuteButtons();render();
    return true;
  }catch(error){console.warn('latest state restore failed',error);return false;}
}
let projectStoreReady = false;
function captureProject(){
  return {version:1,current:snapshot(),patternSlots:structuredClone(patternSlots),selectedPattern,bpm,swing,loopEnabled,paletteIndex,songTitle};
}
function applyProject(data){
  if(!data || !data.current?.model || !Array.isArray(data.patternSlots))throw new Error('Invalid moacl project');
  if(playing)stop();
  queuedPattern=null;
  ({model,rhythmEvents,keyRoot,rhythmDensity,melodicMuted,rhythmMuted,activeStepCount,meloLong=false,beat=0}=structuredClone(data.current));
  swing=Math.max(-5,Math.min(5,Number(data.swing ?? data.current.swing) || 0));
    meloMode=Number.isInteger(data.current.meloMode)?Math.max(0,Math.min(3,data.current.meloMode)):(meloLong?1:0);
    meloLong=meloMode===1;
  rhythmSubsteps=Array.from({length:STEP_COUNT},(_,i)=>[2,3,4].includes(data.current.rhythmSubsteps?.[i])?data.current.rhythmSubsteps[i]:0);
  meloSubsteps=Array.from({length:STEP_COUNT},(_,i)=>!!data.current.meloSubsteps?.[i]);
  for(let i=0;i<patternSlots.length;i++)patternSlots[i]=structuredClone(data.patternSlots[i]??null);
  selectedPattern=Math.max(1,Math.min(patternSlots.length,Number(data.selectedPattern)||1));
  bpm=Math.max(40,Math.min(240,Number(data.bpm)||105));
  loopEnabled=Boolean(data.loopEnabled);
  songTitle=typeof data.songTitle==='string'&&data.songTitle.trim()?data.songTitle.trim().slice(0,80):'untitled';
  updateSongTitle();paletteIndex=Math.max(0,Math.min(5,Number(data.paletteIndex)||0));
  document.body.className=paletteIndex?`palette-${paletteIndex}`:'';
  document.querySelector('#loop').textContent=loopEnabled?'[L]':'L';
  undoStack.length=0;redoStack.length=0;updateHistoryButtons();clearPatternClipboard();
  setBpm(bpm);setRhythmDensity(rhythmDensity);updateMuteButtons();render();
  saveLatestState();
}
// Offline WAV export. moacl currently has no song arrangement, so export the
// selected pattern; future song arrangement can reuse the same renderer.
async function exportCurrentPatternWav(){
 if(playing)await stop();
 const Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext;
 if(!Offline)throw Error('Offline audio export is unsupported on this device');
 const sampleRate=48000,stepSeconds=60/currentBpm()/4;
 const duration=activeStepCount*stepSeconds,tail=3;
 const ctx=new Offline(2,Math.ceil((duration+tail)*sampleRate),sampleRate);
 const restore=await beginOfflineAudioRender(ctx,{masterVolume:70});
 let rendered;
 try{
  for(let i=0;i<activeStepCount;i++){
   const ev=model.events[i],soundId=rhythmEvents[i],time=i*stepSeconds;
   if(!melodicMuted&&ev){
    const audible=ev.chromaticPassing?Math.random()<.30:((ev.anchor?showForceMark(ev):ev.forceSound||ev.profile1RootSupport)||Math.random()<.60);
    if(audible){
     const sub=ev.notes.length>=1&&ev.notes.length<=4&&meloSubsteps[i];
     const notes=sub?[...ev.notes].sort((a,b)=>a-b):ev.notes;
     if(sub&&notes.length===4){
      const next=model.events[(i+1)%activeStepCount];
      if(next?.notes?.length&&Math.min(...next.notes)<notes[3])notes.reverse();
     }
     const slices=sub?(notes.length===1?4:notes.length):1;
     const sequence=sub&&notes.length===1?[notes[0],null,notes[0],null]:notes;
     for(let hit=0;hit<sequence.length;hit++){
      const note=sequence[hit];
      if(note===null)continue;
      await playSequenceStep({melodic:{soundId:'1',note:note-60,chord:'off',gain:ev.notes.length>=3?70:86,pan:0,probability:100,subPattern:-1,nudge:0,strum:0},rhythm:null},bank,time+(sub?hit*stepSeconds/slices:0),{bpm:currentBpm(),ignoreProbability:true,gateSecondsOverride:sub?stepSeconds/slices:stepSeconds,allowPolyphonicOverlap:true,meloLongSustain:false,meloEnvelopeMode:meloMode});
     }
    }
   }
   if(!rhythmMuted&&soundId){
    const hits=[2,3,4].includes(rhythmSubsteps[i])?rhythmSubsteps[i]:1;
    for(let hit=0;hit<hits;hit++)await playSequenceStep({melodic:null,rhythm:{soundId,note:0,gain:hits===1?100:50,pan:0,probability:100,subPattern:-1,subProbability:100,nudge:0}},bank,time+hit*stepSeconds/hits,{bpm:currentBpm(),ignoreProbability:true});
   }
  }
  rendered=await ctx.startRendering();
 }finally{restore();}
 const frames=rendered.length,bytes=44+frames*2*2,buffer=new ArrayBuffer(bytes),view=new DataView(buffer);
 const ascii=(offset,str)=>{for(let i=0;i<str.length;i++)view.setUint8(offset+i,str.charCodeAt(i));};
 ascii(0,'RIFF');view.setUint32(4,bytes-8,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*4,true);view.setUint16(32,4,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,frames*4,true);
 const left=rendered.getChannelData(0),right=rendered.getChannelData(Math.min(1,rendered.numberOfChannels-1));
 for(let i=0;i<frames;i++)for(let c=0;c<2;c++){const v=Math.max(-1,Math.min(1,(c?right:left)[i]));view.setInt16(44+i*4+c*2,v<0?v*32768:v*32767,true);}
 const blob=new Blob([buffer],{type:'audio/wav'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=`${songTitle.replace(/[\\/:*?"<>|]/g,'_') || 'untitled'}.wav`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
const projectStore=createProjectStore({capture:captureProject,apply:applyProject,exportAudio:exportCurrentPatternWav,makeNew:()=>{
  if(playing)stop();
  for(let i=0;i<patternSlots.length;i++)patternSlots[i]=null;
  selectedPattern=1;activeStepCount=32;keyRoot=0;rhythmDensity=3;
  melodicMuted=false;rhythmMuted=false;swing=0;bpm=105;loopEnabled=false;
  songTitle='untitled';updateSongTitle();undoStack.length=0;redoStack.length=0;updateHistoryButtons();
  clearPatternClipboard();meloSubsteps=Array(STEP_COUNT).fill(false);generateMelo();generateRhythm();
  document.querySelector('#loop').textContent='L';setBpm(bpm);updateMuteButtons();render();
}});
function restoreSnapshot(x){if(!x)return;const globalMeloMute=melodicMuted,globalRhythmMute=rhythmMuted;({model,rhythmEvents,keyRoot,rhythmDensity,melodicMuted,rhythmMuted,activeStepCount,meloLong=false,beat=0}=structuredClone(x));melodicMuted=globalMeloMute;rhythmMuted=globalRhythmMute;meloMode=Number.isInteger(x.meloMode)?Math.max(0,Math.min(3,x.meloMode)):(meloLong?1:0);meloLong=meloMode===1;updateMeloControls();rhythmSubsteps=Array.from({length:STEP_COUNT},(_,i)=>[2,3,4].includes(x.rhythmSubsteps?.[i])?x.rhythmSubsteps[i]:0);meloSubsteps=Array.from({length:STEP_COUNT},(_,i)=>!!x.meloSubsteps?.[i]);setRhythmDensity(rhythmDensity);updateMuteButtons();render();}
function pushHistory(){undoStack.push(snapshot());if(undoStack.length>20)undoStack.shift();redoStack.length=0;updateHistoryButtons();}
function undo(){if(!undoStack.length)return;redoStack.push(snapshot());restoreSnapshot(undoStack.pop());updateHistoryButtons();}
function redo(){if(!redoStack.length)return;undoStack.push(snapshot());restoreSnapshot(redoStack.pop());updateHistoryButtons();}
function saveCurrentPattern(){patternSlots[selectedPattern-1]=snapshot();}
function selectPatternSlot(n){queuedPattern=null;saveCurrentPattern();selectedPattern=n;const saved=patternSlots[n-1];if(saved)restoreSnapshot(saved);else{pushHistory();generateMelo();generateRhythm();}updatePatternButtons();}
function updatePatternClipboard(){document.querySelector('#pattern-clip')?.classList.toggle('has-clipboard',!!patternClipboard);}
function clearPatternClipboard(){patternClipboard=null;lastPatternTap=null;updatePatternClipboard();}
function copyPatternSlot(n){
  if(n!==selectedPattern && !patternSlots[n-1] && !playing)selectPatternSlot(n);
  patternClipboard={source:n,data:structuredClone(n===selectedPattern?snapshot():patternSlots[n-1])};
  updatePatternClipboard();
}
function pastePatternSlot(n){
  if(!patternClipboard || n===patternClipboard.source)return;
  saveCurrentPattern();
  selectedPattern=n;
  const copied=structuredClone(patternClipboard.data);
  patternSlots[n-1]=copied;
  restoreSnapshot(copied);
  clearPatternClipboard();
  updatePatternButtons();
  saveLatestState();
}
function handlePatternTap(n){
  if(patternClipboard){pastePatternSlot(n);return;}
  const now=performance.now();
  if(lastPatternTap?.index===n && now-lastPatternTap.time<350){
    lastPatternTap=null;
    copyPatternSlot(n);
    return;
  }
  lastPatternTap={index:n,time:now};
  if(playing){queuedPattern=n===selectedPattern?null:n;updatePatternButtons();}
  else if(n!==selectedPattern)selectPatternSlot(n);
}
function updatePatternButtons(){
  const host=document.querySelector('#patterns');if(!host)return;
  if(!host.children.length){for(let i=1;i<=patternSlots.length;i++){
    const b=document.createElement('button');b.dataset.pattern=i;
    b.addEventListener('click',()=>handlePatternTap(i));host.append(b);
  }}
  [...host.children].forEach((b,i)=>b.textContent=(i+1===selectedPattern)?`[${PATTERN_LABELS[i]}]`:(i+1===queuedPattern?`>${PATTERN_LABELS[i]}`:PATTERN_LABELS[i]));
}
function deleteAll(){pushHistory();model.events=Array(STEP_COUNT).fill(null);rhythmEvents=Array(STEP_COUNT).fill(null);rhythmSubsteps=Array(STEP_COUNT).fill(0);meloSubsteps=Array(STEP_COUNT).fill(false);render();}
function bindVerticalSwipe(el,get,set,min,max,px=20){let drag=null;el.addEventListener('pointerdown',e=>{drag={id:e.pointerId,y:e.clientY};el.setPointerCapture?.(e.pointerId);e.preventDefault();});el.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const d=drag.y-e.clientY;if(Math.abs(d)<px)return;const steps=Math.trunc(d/px);set(Math.max(min,Math.min(max,get()+steps)));drag.y-=steps*px;e.preventDefault();});const done=e=>{if(!drag||drag.id!==e.pointerId)return;el.releasePointerCapture?.(e.pointerId);drag=null};el.addEventListener('pointerup',done);el.addEventListener('pointercancel',done);}

const keyValueEl=document.querySelector('#key-value');
let keySwipe=null;
const KEY_SWIPE_PX=28;
keyValueEl.addEventListener('pointerdown',event=>{
  keySwipe={pointerId:event.pointerId,lastY:event.clientY,moved:false};
  keyValueEl.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});
keyValueEl.addEventListener('pointermove',event=>{
  if(!keySwipe || keySwipe.pointerId!==event.pointerId)return;
  let delta=keySwipe.lastY-event.clientY;
  if(Math.abs(delta)<KEY_SWIPE_PX)return;
  const direction=delta>0?1:-1;
  keySwipe.lastY+=direction*-KEY_SWIPE_PX;
  keySwipe.moved=true;
  editWhilePlaying(()=>{
    keyRoot=(keyRoot+direction+12)%12;
    revoiceForCurrentKey();
  });
  event.preventDefault();
});
const finishKeySwipe=event=>{
  if(!keySwipe || keySwipe.pointerId!==event.pointerId)return;
  keyValueEl.releasePointerCapture?.(event.pointerId);
  keySwipe=null;
};
keyValueEl.addEventListener('pointerup',finishKeySwipe);
keyValueEl.addEventListener('pointercancel',finishKeySwipe);
const bpmValueEl=document.querySelector('#bpm-value');
let bpm=105;
function currentBpm(){return Math.max(40,Math.min(240,bpm));}
function setBpm(value){bpm=Math.max(40,Math.min(240,Math.round(value)));if(bpmValueEl)bpmValueEl.textContent=String(bpm);if(model)saveLatestState();}
let bpmSwipe=null;
const BPM_SWIPE_PX=5;
bpmValueEl.addEventListener('pointerdown',event=>{
  bpmSwipe={pointerId:event.pointerId,lastY:event.clientY};
  bpmValueEl.setPointerCapture?.(event.pointerId); event.preventDefault();
});
bpmValueEl.addEventListener('pointermove',event=>{
  if(!bpmSwipe || bpmSwipe.pointerId!==event.pointerId)return;
  const delta=bpmSwipe.lastY-event.clientY;
  if(Math.abs(delta)<BPM_SWIPE_PX)return;
  const steps=Math.trunc(delta/BPM_SWIPE_PX);
  setBpm(bpm+steps);
  bpmSwipe.lastY-=steps*BPM_SWIPE_PX;
  event.preventDefault();
});
const finishBpmSwipe=event=>{
  if(!bpmSwipe || bpmSwipe.pointerId!==event.pointerId)return;
  bpmValueEl.releasePointerCapture?.(event.pointerId); bpmSwipe=null;
};
bpmValueEl.addEventListener('pointerup',finishBpmSwipe);
bpmValueEl.addEventListener('pointercancel',finishBpmSwipe);

document.querySelector('#steps').addEventListener('click',event=>{
  const step=event.target.closest('.step');
  if(!step)return;
  openStepEditor(Number(step.dataset.step));
});
document.querySelector('#step-editor-close').addEventListener('click',closeStepEditor);
document.querySelector('#step-editor-prev').addEventListener('click',()=>moveStepEditor(-1));
document.querySelector('#step-editor-next').addEventListener('click',()=>moveStepEditor(1));
document.querySelector('#step-force-sound').addEventListener('click',()=>editWhilePlaying(toggleEditorForceSound));
document.querySelector('#step-note-left').addEventListener('click',()=>editWhilePlaying(()=>shiftEditorNotes(-1)));
document.querySelector('#step-note-right').addEventListener('click',()=>editWhilePlaying(()=>shiftEditorNotes(1)));
document.querySelectorAll('#step-editor [data-rhythm]').forEach(b=>b.addEventListener('click',()=>editWhilePlaying(()=>setEditorRhythm(b.dataset.rhythm))));
document.querySelector('#step-rhythm-substeps').addEventListener('click',()=>editWhilePlaying(cycleEditorRhythmSubsteps));
document.querySelector('#step-melo-substeps').addEventListener('click',()=>editWhilePlaying(toggleEditorMeloSubsteps));

document.querySelector('#melo-mode').addEventListener('click',()=>{
  // chillgen teacher-grammar validation: legacy envelope modes are disabled.
  meloMode=0;
  meloLong=false;
  heldMelo.clear();
  updateMeloControls();
});
const meloBeatEl=document.querySelector('#melo-beat');
let beatPointer=null;
meloBeatEl.addEventListener('pointerdown',event=>{beatPointer={id:event.pointerId,y:event.clientY};meloBeatEl.setPointerCapture?.(event.pointerId);event.preventDefault();});
meloBeatEl.addEventListener('pointermove',event=>{if(!beatPointer||beatPointer.id!==event.pointerId)return;const delta=beatPointer.y-event.clientY;const steps=Math.trunc(delta/18);if(!steps)return;beat=Math.max(0,Math.min(9,beat+steps));beatPointer.y-=steps*18;updateMeloControls();saveLatestState();event.preventDefault();});
for(const name of ['pointerup','pointercancel'])meloBeatEl.addEventListener(name,event=>{if(beatPointer?.id===event.pointerId){meloBeatEl.releasePointerCapture?.(event.pointerId);beatPointer=null;}});
let g13GenerationId=0,g13Current=null,g13Ratings=[];
function g13Snapshot(){return {id:++g13GenerationId,key:KEY_NAMES[keyRoot],steps:activeStepCount,events:model.events.slice(0,activeStepCount).map((e,i)=>e?.notes?.length?{step:i+1,notes:[...e.notes],duration:e.noteDurationSteps?[...e.noteDurationSteps]:null,gesture:e.teacherGesture||null}:null).filter(Boolean)};}
function g13Rate(mark){if(!g13Current)g13Current=g13Snapshot();const row={...g13Current,rating:mark};const i=g13Ratings.findIndex(x=>x.id===row.id);if(i>=0)g13Ratings[i]=row;else g13Ratings.push(row);for(const [id,m] of [['#rate-good','○'],['#rate-mid','△'],['#rate-bad','×']])document.querySelector(id).textContent=m===mark?'['+m+']':m;}
async function g13Copy(){const payload=JSON.stringify({version:'g13',count:g13Ratings.length,ratings:g13Ratings},null,2);try{await navigator.clipboard.writeText(payload);const b=document.querySelector('#rate-copy');b.textContent='[cp]';setTimeout(()=>b.textContent='cp',900);}catch(e){console.error(e);}}
for(const [id,m] of [['#rate-good','○'],['#rate-mid','△'],['#rate-bad','×']])document.querySelector(id).addEventListener('click',()=>g13Rate(m));
document.querySelector('#rate-copy').addEventListener('click',g13Copy);
document.querySelector('#melo-generate').addEventListener('click',()=>editWhilePlaying(()=>{pushHistory();generateMeloG15();g13Current=g13Snapshot();for(const id of ['#rate-good','#rate-mid','#rate-bad']){const b=document.querySelector(id);b.textContent=b.id==='rate-good'?'○':b.id==='rate-mid'?'△':'×';}}));
document.querySelector('#rhythm-generate').addEventListener('click',()=>editWhilePlaying(()=>{pushHistory();generateRhythm()}));
document.querySelector('#play').addEventListener('click',()=>playing?stop():play());
document.querySelector('#melo-shift-left').addEventListener('click',()=>editWhilePlaying(()=>{pushHistory();shiftMelo(-1)}));
document.querySelector('#melo-shift-right').addEventListener('click',()=>editWhilePlaying(()=>{pushHistory();shiftMelo(1)}));
document.querySelector('#rhythm-shift-left').addEventListener('click',()=>editWhilePlaying(()=>{pushHistory();shiftRhythm(-1)}));
document.querySelector('#rhythm-shift-right').addEventListener('click',()=>editWhilePlaying(()=>{pushHistory();shiftRhythm(1)}));
document.querySelector('#double-copy').addEventListener('click',()=>editWhilePlaying(doubleCopySteps));
document.querySelector('#sort-all').addEventListener('click',()=>editWhilePlaying(sortAllSteps));
document.querySelector('#melo-mute').addEventListener('click',()=>{melodicMuted=!melodicMuted;updateMuteButtons();saveLatestState()});
document.querySelector('#rhythm-mute').addEventListener('click',()=>{rhythmMuted=!rhythmMuted;updateMuteButtons();saveLatestState()});
const rhythmDensityEl=document.querySelector('#rhythm-density');
let densitySwipe=null;
const DENSITY_SWIPE_PX=24;
rhythmDensityEl.addEventListener('pointerdown',event=>{
  densitySwipe={pointerId:event.pointerId,lastY:event.clientY};
  rhythmDensityEl.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});
rhythmDensityEl.addEventListener('pointermove',event=>{
  if(!densitySwipe || densitySwipe.pointerId!==event.pointerId)return;
  const delta=densitySwipe.lastY-event.clientY;
  if(Math.abs(delta)<DENSITY_SWIPE_PX)return;
  const direction=delta>0?1:-1;
  const next=Math.max(0,Math.min(9,rhythmDensity+direction));
  if(next!==rhythmDensity)setRhythmDensity(next);
  densitySwipe.lastY+=direction*-DENSITY_SWIPE_PX;
  event.preventDefault();
});
const finishDensitySwipe=event=>{
  if(!densitySwipe || densitySwipe.pointerId!==event.pointerId)return;
  rhythmDensityEl.releasePointerCapture?.(event.pointerId);
  densitySwipe=null;
};
rhythmDensityEl.addEventListener('pointerup',finishDensitySwipe);
rhythmDensityEl.addEventListener('pointercancel',finishDensitySwipe);
document.querySelector('#loop').addEventListener('click',()=>{loopEnabled=!loopEnabled;document.querySelector('#loop').textContent=loopEnabled?'[L]':'L';saveLatestState();});
document.querySelector('#pattern-clip').addEventListener('click',()=>{
  clearPatternClipboard();
});
document.querySelector('#undo').addEventListener('click',undo);
document.querySelector('#redo').addEventListener('click',redo);
document.querySelector('#delete-all').addEventListener('click',()=>editWhilePlaying(deleteAll));
let paletteIndex=0;document.querySelector('#palette').addEventListener('click',()=>{paletteIndex=(paletteIndex+1)%6;document.body.className=paletteIndex?`palette-${paletteIndex}`:'';saveLatestState();});
document.querySelector('#help').addEventListener('click',()=>{const p=document.querySelector('#help-panel');p.hidden=!p.hidden;document.querySelector('#help').textContent=p.hidden?'?':'[?]';document.querySelector('#menu-panel').hidden=true;document.querySelector('#menu').textContent='=';});
document.querySelector('#menu').addEventListener('click',()=>{const p=document.querySelector('#menu-panel');p.hidden=!p.hidden;document.querySelector('#menu').textContent=p.hidden?'=':'[=]';document.querySelector('#help-panel').hidden=true;document.querySelector('#help').textContent='?';});
projectStore.bindMenu(document.querySelector('#menu-panel'));
bindVerticalSwipe(document.querySelector('#step-count'),()=>activeStepCount,v=>{pushHistory();activeStepCount=v;render();},1,64,14);
bindVerticalSwipe(document.querySelector('#swing'),()=>swing,v=>{swing=v;render();},-5,5,18);
setBpm(105);
setRhythmDensity(3);
if(!restoreLatestState()){
  generateMelo();
  generateRhythm();
  updateMuteButtons();
}
projectStore.initialize().then(()=>{projectStoreReady=true;}).catch(error=>console.error('Project initialization failed',error));

// Catch edits that render without calling saveLatestState; compare snapshots after interactions.
document.addEventListener('pointerup',()=>{if(projectStoreReady)setTimeout(()=>projectStore.markChanged(),0);});
document.addEventListener('change',()=>{if(projectStoreReady)setTimeout(()=>projectStore.markChanged(),0);});
