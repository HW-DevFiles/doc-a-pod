import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoScript, validateScript, writeScript, sourceChunks, wordCount, TOPICS, PROMPT_CHARS } from '../src/script.js';
import { configuration } from '../src/config.js';
import { PAPER } from './helpers.js';

test('offline script is deterministic, source-grounded, alternating and complete', async () => {
  const script = await writeScript(PAPER, 'demo', configuration());
  assert.deepEqual(script.lines, demoScript(PAPER).lines);
  assert.equal(script.lines.length, 8); assert.equal(script.pages, 1);
  assert.match(script.lines.map(l => l.text).join(' '), /40 adults/);
  for (const topic of TOPICS) assert.ok(script.lines.some(l => l.topic === topic && l.host === 'Maya'));
  assert.equal(script.words, wordCount(script.lines.map(l => `${l.host}: ${l.text}`).join('\n')));
});
test('cap counts host labels and rejects rather than truncating a 10-page overflow', () => {
  const lines = Array.from({length:100}, (_, i) => ({host: i % 2 ? 'Maya' : 'Leo', topic: TOPICS[Math.floor(i / 2) % 4], text: `${'word '.repeat(48)}end.`}));
  assert.equal(validateScript({lines}).words, 5000);
  assert.equal(validateScript({lines}).pages, 10);
  lines[0].text += ' Extra.';
  assert.throws(() => validateScript({lines}), /10-page cap/);
});
test('shape guard rejects missing topics, nonalternating hosts, and incomplete thoughts', () => {
  for (const mutate of [s => { s.lines[1].host = 'Leo'; }, s => { s.lines.forEach(l => l.topic = 'question'); }, s => { s.lines[1].text = 'An unfinished thought'; }]) {
    const script = demoScript(PAPER); mutate(script); assert.throws(() => validateScript(script));
  }
});
test('Ollama requests configured model and rewrites invalid output without clipping', async () => {
  const calls = [];
  const script = await writeScript(PAPER, 'ollama', configuration({OLLAMA_MODEL:'test-model'}), { fetchImpl: async (_url, request) => {
    calls.push(JSON.parse(request.body));
    return Response.json({ response: calls.length === 1 ? '{"lines":[]}' : JSON.stringify(demoScript(PAPER)), done_reason:'stop' });
  }});
  assert.equal(calls.length, 2); assert.equal(calls[0].model, 'test-model'); assert.match(calls[1].prompt, /previous result was invalid/);
  assert.ok(script.words <= 5000);
});
test('long sources are fully covered by map summaries before dialogue generation', async () => {
  const text = PAPER.repeat(150) + ' THE FINAL LIMITATION.';
  assert.equal(sourceChunks(text).join(''), text);
  const calls = [];
  const script = await writeScript(text, 'ollama', configuration(), { fetchImpl: async (_url, request) => {
    const body = JSON.parse(request.body); calls.push(body);
    return Response.json({response: body.format ? JSON.stringify(demoScript(PAPER)) : 'This section reports a small study with limited follow-up.'});
  }});
  assert.match(calls.at(-2).prompt, /THE FINAL LIMITATION/);
  assert.equal(calls.length, sourceChunks(text).length + 1);
  assert.match(script.warning, /section summaries/);
});
test('every Ollama prompt stays within the prompt bound, including notes from a maximum-size paper', async () => {
  const paperOf = prompt => prompt.match(/<paper>\n([\s\S]*)\n<\/paper>/)[1];
  const run = async text => {
    const calls = [];
    const script = await writeScript(text, 'ollama', configuration(), { fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body); calls.push(body);
      return Response.json({response: body.format ? JSON.stringify(demoScript(PAPER)) : 'Dense notes about a section. '.repeat(55).trim()});
    }});
    assert.match(script.warning, /section summaries/);
    for (const call of calls) assert.ok(paperOf(call.prompt).length <= PROMPT_CHARS);
    return calls.filter(call => !call.format).length;
  };
  assert.equal(await run(PAPER.repeat(80).slice(0, 30_000)), 2);
  const largest = 'evidence '.repeat(55_556).slice(0, 500_000);
  assert.ok(await run(largest) > sourceChunks(largest).length);
});
test('provider failures are explicit and never silently fall back', async () => {
  await assert.rejects(writeScript(PAPER, 'hosted', configuration()), /Unknown/);
  await assert.rejects(writeScript(PAPER, 'ollama', configuration(), {fetchImpl: async () => {throw new Error('offline');}}), /Ollama is unavailable/);
  let attempts = 0;
  await assert.rejects(writeScript(PAPER, 'ollama', configuration(), {fetchImpl: async () => {attempts++; return Response.json({response:'{}'});}}), /after two attempts/);
  assert.equal(attempts, 2);
});

test('offline previews retain complete thoughts within turn limits even with long source sentences', () => {
  const source = `This study ${'investigated '.repeat(72)}attention. The method used a small sample. Results remained uncertain. Limits include low power.`;
  const script = demoScript(source);
  assert.ok(script.lines.every(line => wordCount(line.text) <= 100));
  assert.match(script.lines[1].text, /could not identify/);
});
