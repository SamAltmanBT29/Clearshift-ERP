export * from './cli/index.js';
import { main } from './cli/index.js';

const isDirect = process.argv[1] && (process.argv[1].endsWith('cli.ts') || process.argv[1].endsWith('cli.js'));
if (isDirect) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
