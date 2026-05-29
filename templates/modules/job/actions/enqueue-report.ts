import { action } from '@ploykit/module-sdk';

export default action(async () => ({
  ok: true,
  queued: 'generate_report',
}));
