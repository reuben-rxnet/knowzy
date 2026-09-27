// npm run secrets -- <init|set|remove|list|status> [name]
//
// The local secure store's operator tool (P-5). The ONLY way a secret enters
// the store: there is no browser upload, no API route and no environment
// variable that writes one, because each of those is a path by which a key
// reaches a log, a request body or a process listing.
//
//   init           create the key and an empty store (idempotent)
//   set <name>     store a secret; the VALUE is read from a hidden prompt, or
//                  from stdin when piped -- never from an argument, which
//                  would put it in shell history and the process list
//   remove <name>  delete one
//   list           names only
//   status         whether the store is readable, and how many secrets
//
// The directory is KNOWZY_LOCAL_SECRET_DIR, or `.secrets/` at the repository
// root, which is gitignored AND dockerignored. The API container sees the same
// directory through the repository mount at /repo/.secrets.
//
// Then reference the secret on the AI Providers screen as localstore://<name>.

import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { createLocalSecureStore, readProcessEnv } from '@knowzy/configuration';

const env = readProcessEnv();
const directory = env['KNOWZY_LOCAL_SECRET_DIR'] ?? join(process.cwd(), '.secrets');
const store = createLocalSecureStore(directory);
const [command, name] = process.argv.slice(2);

const readSecret = async (): Promise<string> => {
  if (!process.stdin.isTTY) {
    // Piped: read everything, strip ONE trailing newline (what `echo` adds).
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks)
      .toString('utf8')
      .replace(/\r?\n$/, '');
  }
  // Interactive: prompt with echo suppressed.
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const output = rl as unknown as { _writeToOutput: (text: string) => void };
  let muted = false;
  output._writeToOutput = (text: string) => {
    if (!muted) process.stdout.write(text);
  };
  return new Promise((resolve) => {
    rl.question('Secret value (input hidden): ', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
};

const main = async (): Promise<void> => {
  switch (command) {
    case 'init': {
      const result = await store.init();
      process.stdout.write(
        `${result.created ? 'Created' : 'Already present:'} local secure store at ${directory} (key ${result.keyFingerprint}).\n`,
      );
      return;
    }
    case 'set': {
      if (name === undefined) throw new Error('Usage: npm run secrets -- set <name>');
      await store.init();
      const value = await readSecret();
      const { created } = await store.set(name, value);
      // The length, never the value, so an operator can tell a paste worked.
      process.stdout.write(
        `${created ? 'Stored' : 'Replaced'} "${name}" (${value.length} characters). Reference it as localstore://${name}.\n`,
      );
      return;
    }
    case 'remove': {
      if (name === undefined) throw new Error('Usage: npm run secrets -- remove <name>');
      process.stdout.write(
        (await store.remove(name)) ? `Removed "${name}".\n` : `No secret named "${name}".\n`,
      );
      return;
    }
    case 'list': {
      const names = await store.names();
      process.stdout.write(names.length === 0 ? 'The store is empty.\n' : `${names.join('\n')}\n`);
      return;
    }
    case 'status': {
      const health = await store.health();
      process.stdout.write(
        `${health.detail}${health.secretCount === null ? '' : ` ${health.secretCount} secret(s).`}\n`,
      );
      return;
    }
    default:
      throw new Error('Usage: npm run secrets -- <init|set|remove|list|status> [name]');
  }
};

main().catch((error: unknown) => {
  // The message only. No stack, which could quote a line holding a value.
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
