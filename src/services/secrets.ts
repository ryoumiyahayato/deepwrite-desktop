import { appDataDir, join } from '@tauri-apps/api/path';
import { Stronghold, type Client } from '@tauri-apps/plugin-stronghold';
import { invokeCommand, isTauri } from './platform';

const CLIENT_NAME = 'deepwrite-settings';
const KEY_NAME = 'deepseek-api-key';
let session: Promise<{ stronghold: Stronghold; client: Client }> | null = null;

async function getSession() {
  if (!isTauri()) throw new Error('安全凭据只能在桌面应用中使用。');
  session ??= (async () => {
    const [directory, password] = await Promise.all([
      appDataDir(),
      invokeCommand<string>('vault_password')
    ]);
    const stronghold = await Stronghold.load(await join(directory, 'deepwrite.vault.hold'), password);
    let client: Client;
    try { client = await stronghold.loadClient(CLIENT_NAME); }
    catch { client = await stronghold.createClient(CLIENT_NAME); }
    return { stronghold, client };
  })();
  return session;
}

export async function saveDeepSeekKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error('API Key 不能为空。');
  const { stronghold, client } = await getSession();
  await client.getStore().insert(KEY_NAME, Array.from(new TextEncoder().encode(trimmed)));
  await stronghold.save();
}

export async function readDeepSeekKey(): Promise<string | null> {
  const { client } = await getSession();
  const data = await client.getStore().get(KEY_NAME);
  return data ? new TextDecoder().decode(data) : null;
}

export async function deleteDeepSeekKey(): Promise<void> {
  const { stronghold, client } = await getSession();
  await client.getStore().remove(KEY_NAME);
  await stronghold.save();
}

export async function hasDeepSeekKey(): Promise<boolean> {
  try { return Boolean(await readDeepSeekKey()); }
  catch { return false; }
}
