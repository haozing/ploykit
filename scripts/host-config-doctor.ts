import { runHostConfigDoctor } from '../apps/host-next/lib/config-doctor';

const required = process.argv.includes('--required');
const report = await runHostConfigDoctor({ required, projectRoot: process.cwd() });

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ok ? 0 : 1;
