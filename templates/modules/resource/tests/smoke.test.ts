import assert from 'node:assert/strict';
import test from 'node:test';
import { validateModuleDefinition } from '@ploykit/module-sdk';
import moduleDefinition from '../module';

test('__MODULE_ID__ resource template declares resource facts', () => {
  assert.ok(moduleDefinition.resources?.notes);
  assert.equal(moduleDefinition.pages?.[0]?.id, '__MODULE_ID__.notes.list');
  assert.deepEqual(
    moduleDefinition.pages?.map((page) => page.component),
    [
      './pages/NotesListPage.tsx',
      './pages/NoteCreatePage.tsx',
      './pages/NoteEditPage.tsx',
      './pages/NoteDetailPage.tsx',
    ]
  );
  assert.deepEqual(validateModuleDefinition(moduleDefinition), []);
});
