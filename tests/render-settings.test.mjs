import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../js/RenderSettings.js', import.meta.url), 'utf8');
const { ResolutionGovernor, FramePacer, initialPreset } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
function run(governor, ms, seconds) {
  for (let i = 0; i < seconds * 1000 / ms; i++) governor.sample(ms);
}
test('sustained overload reaches the floor and stable 60 Hz recovers without oscillating', () => {
  const changes = [], governor = new ResolutionGovernor((scale) => changes.push(scale));
  run(governor, 25, 30);
  assert.deepEqual(changes, [.85, .7, .6]);
  run(governor, 1000 / 60, 80);
  assert.deepEqual(changes, [.85, .7, .6, .7, .85, 1]);
  run(governor, 1000 / 60, 30);
  assert.equal(changes.length, 6);
});
test('isolated hitches and suspended tabs cannot trigger resolution drops', () => {
  const changes = [], governor = new ResolutionGovernor((scale) => changes.push(scale));
  for (let second = 0; second < 30; second++) {
    run(governor, 1000 / 60, .98); governor.sample(80);
  }
  assert.deepEqual(changes, []);
  for (const ms of [5000, NaN, -2, 0, Infinity]) governor.sample(ms);
  governor.sample(40, false);
  run(governor, 1000 / 60, 5);
  assert.deepEqual(changes, []);
});
test('manual effect quality does not enter resolution governor and device defaults are conservative', () => {
  assert.equal(initialPreset({ maxTouchPoints: 5, hardwareConcurrency: 12 }), 'low');
  assert.equal(initialPreset({ deviceMemory: 4, hardwareConcurrency: 16 }), 'low');
  assert.equal(initialPreset({ hardwareConcurrency: 8 }), 'high');
  assert.equal(initialPreset({}), 'medium');
});

test('mobile sustained overload locks to 30fps only at the resolution floor, with explicit retry', () => {
  const changes = [], limits = [];
  const governor = new ResolutionGovernor(scale => changes.push(scale), {allow30fps:true,onFrameRate:fps=>limits.push(fps)});
  run(governor, 25, 40);
  assert.deepEqual(changes, [.85,.7,.6]); assert.deepEqual(limits,[30]);
  run(governor, 1000/60, 80);
  assert.deepEqual(changes, [.85,.7,.6]); assert.deepEqual(limits,[30]);
  governor.retry60fps(); assert.deepEqual(limits,[30,60]);
  run(governor, 1000/60, 80); assert.equal(changes.at(-1),1);
});

test('presentation cap on 60Hz and 120Hz keeps simulation callbacks running', () => {
  for (const hz of [60,120]) {
    const pacer = new FramePacer(); pacer.setTarget(30);
    let presentations = 0, simulations = 0;
    for (let i=0;i<hz*10;i++) { simulations++; if (pacer.shouldRender(i*1000/hz)) presentations++; }
    assert.equal(simulations,hz*10); assert.equal(presentations,300);
    pacer.setTarget(60);
    for (let i=0;i<10;i++) assert.equal(pacer.shouldRender(20000+i*1000/hz),true);
  }
});

test('pacer discards missed presentations after a hitch rather than bursting frames', () => {
  const pacer = new FramePacer(); pacer.setTarget(30);
  assert(pacer.shouldRender(0)); assert(pacer.shouldRender(200));
  assert.equal(pacer.shouldRender(216), false); assert(pacer.shouldRender(234));
  assert.equal(pacer.shouldRender(NaN), false);
  assert(pacer.shouldRender(2000)); assert.equal(pacer.shouldRender(2016), false);
});
