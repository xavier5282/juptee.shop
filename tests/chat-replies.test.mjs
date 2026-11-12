import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerSmallTalk } from '../chat-replies.mjs';
import { onRequestPost } from '../functions/api/chatbot.js';

test('answers greetings and simple questions without searching the product catalog', () => {
  assert.match(answerSmallTalk('Hello!'), /JUPTEE’s shopping assistant/);
  assert.match(answerSmallTalk('How are you?'), /thanks for asking/);
  assert.match(answerSmallTalk('Thank you'), /You’re welcome/);
  assert.match(answerSmallTalk('বিদায়'), /আল্লাহ হাফেজ/);
});

test('leaves shopping and unrelated messages for the regular assistant flow', () => {
  assert.equal(answerSmallTalk('Show me a black hoodie'), '');
  assert.equal(answerSmallTalk('Tell me a joke'), '');
});

test('returns a friendly greeting from the API when the AI provider is unavailable', async () => {
  const db = {
    prepare() {
      return {
        bind() { return this; },
        async all() { return { results: [] }; }
      };
    }
  };
  const response = await onRequestPost({
    request: new Request('https://juptee.shop/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello!' }] })
    }),
    env: { DB: db }
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.match(result.reply, /JUPTEE’s shopping assistant/);
  assert.deepEqual(result.products, []);
});
