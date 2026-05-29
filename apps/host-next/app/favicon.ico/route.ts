import fs from 'node:fs';
import path from 'node:path';

const ICON_PATH = path.resolve(process.cwd(), 'apps', 'host-next', 'public', 'brand', 'favicon.png');

export function GET() {
  const icon = fs.readFileSync(ICON_PATH);
  return new Response(new Uint8Array(icon), {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
