import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('该操作需要在 DeepWrite 桌面应用中运行。');
  return invoke<T>(command, args);
}

export async function chooseOpenPath(extensions: string[], name: string): Promise<string | null> {
  if (!isTauri()) return null;
  const result = await open({ multiple: false, directory: false, filters: [{ name, extensions }] });
  return typeof result === 'string' ? result : null;
}

export async function chooseSavePath(defaultPath: string, extensions: string[], name: string): Promise<string | null> {
  if (!isTauri()) return null;
  return save({ defaultPath, filters: [{ name, extensions }] });
}

export async function readText(path: string): Promise<string> {
  return invokeCommand('read_text', { path });
}

export async function readBinary(path: string): Promise<Uint8Array> {
  const bytes = await invokeCommand<number[]>('read_binary', { path });
  return new Uint8Array(bytes);
}

export async function atomicWriteText(path: string, contents: string): Promise<void> {
  await invokeCommand('atomic_write_text', { path, contents });
}

export async function atomicWriteBinary(path: string, contents: Uint8Array): Promise<void> {
  await invokeCommand('atomic_write_binary', { path, contents: Array.from(contents) });
}

export const fileNameFromPath = (path: string) => path.split(/[\\/]/).pop() ?? path;
export const extensionFromPath = (path: string) => fileNameFromPath(path).split('.').pop()?.toLowerCase() ?? '';
