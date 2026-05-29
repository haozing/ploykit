import { action, type ModuleContext } from '@ploykit/module-sdk';
import { runAiRagDemo } from '../lib/run-ai-rag';

export default action(async function ask(
  ctx: ModuleContext,
  input: { question?: string; source?: string } = {}
) {
  return runAiRagDemo(ctx, input);
});
