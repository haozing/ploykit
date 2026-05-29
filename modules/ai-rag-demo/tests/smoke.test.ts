import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestingModuleContext } from '@ploykit/module-sdk';
import moduleDefinition from '../module';
import ask from '../actions/ask';

test('ai-rag-demo declares AI/RAG page, API and action guards', () => {
  assert.equal(moduleDefinition.routes?.dashboard?.[0]?.path, '/ai-rag-demo');
  assert.equal(moduleDefinition.routes?.api?.[0]?.commercial?.credits?.amount, 1);
  assert.ok(moduleDefinition.permissions?.includes('ai.generate'));
  assert.ok(moduleDefinition.permissions?.includes('rag.write'));
});

test('ai-rag-demo action indexes source and generates an answer', async () => {
  const result = await ask.run(createTestingModuleContext({ moduleId: 'ai-rag-demo' }), {
    question: 'What is covered?',
    source: 'AI and RAG capability coverage.',
  });

  assert.equal(result.ok, true);
  assert.match(result.answer, /Question: What is covered/);
  assert.ok(result.documentId);
  assert.ok(result.fileId);
});
