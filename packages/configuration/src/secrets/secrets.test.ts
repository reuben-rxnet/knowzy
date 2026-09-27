// The Secret Resolution Layer, as tables — P-5.
//
// Each block is one of the promises the layer makes, tested the way it would
// actually be broken: a value interpolated into a string, a store file read by
// a grep, a reference to a source that is not allowed here, an observer that
// might see what it should not.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalSecureStore } from './local-store.js';
import {
  createSecretResolver,
  keyVaultPlaceholderSource,
  localStoreSource,
  referenceFingerprint,
  type SecretResolutionEvent,
} from './resolver.js';
import { REDACTED, SecretValue } from './secret-value.js';

const KEY = 'sk-proj-THIS-IS-A-TEST-VALUE-0123456789abcdefghijklmnop';

describe('SecretValue', () => {
  const secret = new SecretValue(KEY);

  it('reveals only on purpose', () => {
    expect(secret.reveal()).toBe(KEY);
  });

  it('prints [redacted] on every accidental path to text', () => {
    expect(`${secret}`).toBe(REDACTED);
    expect(String(secret)).toBe(REDACTED);
    expect(JSON.stringify({ secret })).toBe(`{"secret":"${REDACTED}"}`);
    expect(inspect(secret)).toBe(REDACTED);
    expect(inspect({ nested: { secret } }, { depth: 5 })).not.toContain(KEY);
    expect(Object.keys(secret)).toEqual([]);
    expect(new Error(`failed with ${secret}`).message).not.toContain(KEY);
  });
});

describe('the local secure store', () => {
  let dir = '';
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'knowzy-secrets-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a secret, and the file on disk does not contain it', async () => {
    const store = createLocalSecureStore(dir);
    await store.init();
    expect((await store.set('openai-api-key', KEY)).created).toBe(true);
    expect((await store.get('openai-api-key'))?.reveal()).toBe(KEY);

    const onDisk = await readFile(join(dir, 'store.json'), 'utf8');
    expect(onDisk).not.toContain(KEY);
    expect(onDisk).not.toContain('sk-proj');
    expect(onDisk).toContain('openai-api-key');
  });

  it('answers null for a secret it does not hold, and lists names only', async () => {
    const store = createLocalSecureStore(dir);
    await store.init();
    await store.set('a-key', 'value-a');
    expect(await store.get('missing')).toBeNull();
    expect(await store.names()).toEqual(['a-key']);
  });

  it('is idempotent to initialize, and never replaces an existing key', async () => {
    const store = createLocalSecureStore(dir);
    const first = await store.init();
    await store.set('a-key', 'value-a');
    const second = await store.init();
    expect(second.created).toBe(false);
    expect(second.keyFingerprint).toBe(first.keyFingerprint);
    expect((await store.get('a-key'))?.reveal()).toBe('value-a');
  });

  it('refuses an entry copied under another name (the name is authenticated)', async () => {
    const store = createLocalSecureStore(dir);
    await store.init();
    await store.set('real', 'value-real');
    const file = JSON.parse(await readFile(join(dir, 'store.json'), 'utf8'));
    file.secrets.impostor = file.secrets.real;
    await writeFile(join(dir, 'store.json'), JSON.stringify(file));
    await expect(store.get('impostor')).rejects.toThrow(/could not be decrypted/);
  });

  it('refuses a store written with a different key, and says so', async () => {
    const store = createLocalSecureStore(dir);
    await store.init();
    await writeFile(join(dir, 'store.key'), Buffer.alloc(32, 7).toString('base64'));
    await expect(store.get('anything')).rejects.toThrow(/different key/);
    expect((await store.health()).reachable).toBe(false);
  });

  it('reports health without names or values', async () => {
    const store = createLocalSecureStore(dir);
    expect((await store.health()).configured).toBe(false);
    await store.init();
    await store.set('one', 'value-one');
    const health = await store.health();
    expect(health).toMatchObject({ reachable: true, secretCount: 1 });
    expect(JSON.stringify(health)).not.toContain('one"');
  });

  it('refuses a name that could escape the naming scheme', async () => {
    const store = createLocalSecureStore(dir);
    await store.init();
    await expect(store.set('../escape', 'x')).rejects.toThrow(/lower-case/);
    await expect(store.set('UPPER', 'x')).rejects.toThrow(/lower-case/);
  });
});

describe('the resolver', () => {
  let dir = '';
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'knowzy-resolver-'));
    const store = createLocalSecureStore(dir);
    await store.init();
    await store.set('openai-api-key', KEY);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const resolverFor = (environment: 'local' | 'prod', events: SecretResolutionEvent[]) =>
    createSecretResolver({
      environment,
      providers: [localStoreSource(createLocalSecureStore(dir)), keyVaultPlaceholderSource(null)],
      onResolution: (event) => {
        events.push(event);
      },
    });

  it('routes a localstore:// reference to the local store', async () => {
    const events: SecretResolutionEvent[] = [];
    const result = await resolverFor('local', events).resolve(
      'localstore://openai-api-key',
      'TEST',
    );
    expect(result.status).toBe('RESOLVED');
    if (result.status === 'RESOLVED') expect(result.value.reveal()).toBe(KEY);
  });

  it('tells the observer the source, a fingerprint and the status -- never a value or reference', async () => {
    const events: SecretResolutionEvent[] = [];
    await resolverFor('local', events).resolve('localstore://openai-api-key', 'TEST');
    expect(events).toHaveLength(1);
    const text = JSON.stringify(events);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('localstore://');
    expect(text).not.toContain('openai-api-key');
    expect(events[0]).toMatchObject({
      source: 'LOCAL_SECURE_STORE',
      status: 'RESOLVED',
      referenceFingerprint: referenceFingerprint('localstore://openai-api-key'),
    });
  });

  it('refuses the local store outside the local environment, with no fallback', async () => {
    const events: SecretResolutionEvent[] = [];
    const result = await resolverFor('prod', events).resolve('localstore://openai-api-key', 'TEST');
    expect(result.status).toBe('SOURCE_FORBIDDEN');
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('reports Key Vault as unavailable -- declared, not implemented', async () => {
    const result = await resolverFor('prod', []).resolve(
      'keyvault://kv-knowzy/secrets/OPENAI-API-KEY',
      'TEST',
    );
    expect(result.status).toBe('SOURCE_UNAVAILABLE');
    if (result.status !== 'RESOLVED') expect(result.detail).toMatch(/no Azure Key Vault client/i);
  });

  it('calls a pasted key INVALID_REFERENCE and does not echo it', async () => {
    const events: SecretResolutionEvent[] = [];
    const result = await resolverFor('local', events).resolve(KEY, 'TEST');
    expect(result.status).toBe('INVALID_REFERENCE');
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(events)).not.toContain(KEY);
  });

  it('answers NOT_FOUND for a reference to a secret the store does not hold', async () => {
    const result = await resolverFor('local', []).resolve('localstore://nothing-here', 'TEST');
    expect(result.status).toBe('NOT_FOUND');
  });

  it('reports health for every source, including the ones not permitted here', async () => {
    const health = await resolverFor('prod', []).health();
    expect(health.map((entry) => entry.source).sort()).toEqual([
      'AZURE_KEY_VAULT',
      'LOCAL_SECURE_STORE',
    ]);
    expect(health.find((entry) => entry.source === 'LOCAL_SECURE_STORE')?.detail).toMatch(
      /not permitted/i,
    );
  });
});
