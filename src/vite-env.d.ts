/// <reference types="vite/client" />

declare module 'mammoth/mammoth.browser' {
  export function convertToHtml(
    input: { arrayBuffer: ArrayBuffer },
    options?: { styleMap?: string[] }
  ): Promise<{ value: string; messages: Array<{ message: string }> }>;
}
