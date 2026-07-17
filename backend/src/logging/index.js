// Resolves the logging configuration and sink once at module load. Any
// configuration or sink setup failure disables logging with a console error
// instead of preventing the backend from serving chat requests.

import { randomUUID } from 'node:crypto';

import { loadLogConfig } from './config.js';
import { createLocalSink } from './local-sink.js';
import { createS3Sink } from './s3-sink.js';
import { RequestTrace } from './trace.js';

let mode = 'off';
let write = null;
try {
  const config = loadLogConfig();
  mode = config.mode;
  if (mode !== 'off') {
    write =
      config.destination === 's3'
        ? await createS3Sink({ bucket: config.s3Bucket, prefix: config.s3Prefix })
        : createLocalSink(config.localDir);
  }
} catch (error) {
  console.error(`Chat logging disabled: ${error.message}`);
  mode = 'off';
  write = null;
}

export function createTrace() {
  return new RequestTrace({ mode, write, requestId: randomUUID() });
}
