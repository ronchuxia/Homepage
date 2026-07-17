import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODES = new Set(['off', 'metadata', 'full']);
const DESTINATIONS = new Set(['local', 's3']);
const BACKEND_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function loadLogConfig() {
  const env = process.env;
  const mode = env.CHAT_LOG_MODE || 'off';
  if (!MODES.has(mode)) {
    throw new Error(`Invalid CHAT_LOG_MODE: ${mode}`);
  }
  if (mode === 'off') return { mode };

  const destination = env.CHAT_LOG_DESTINATION || 'local';
  if (!DESTINATIONS.has(destination)) {
    throw new Error(`Invalid CHAT_LOG_DESTINATION: ${destination}`);
  }
  if (destination === 'local') {
    return {
      mode,
      destination,
      localDir: path.resolve(BACKEND_ROOT, env.CHAT_LOG_LOCAL_DIR || 'logs'),
    };
  }

  const s3Bucket = env.CHAT_LOG_S3_BUCKET || '';
  if (!s3Bucket) {
    throw new Error('CHAT_LOG_S3_BUCKET is required for the s3 log destination.');
  }

  return {
    mode,
    destination,
    s3Bucket,
    s3Prefix: (env.CHAT_LOG_S3_PREFIX || 'chat_logs').replace(/^\/+|\/+$/g, ''),
  };
}
