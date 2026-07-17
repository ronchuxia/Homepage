import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function createLocalSink(directory) {
  return async (record) => {
    const dateDirectory = path.join(directory, record.startedAt.slice(0, 10));
    await mkdir(dateDirectory, { recursive: true });
    await writeFile(
      path.join(dateDirectory, `${record.requestId}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
      'utf8',
    );
  };
}
