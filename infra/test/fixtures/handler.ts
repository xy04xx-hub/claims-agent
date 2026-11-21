// Tiny handler used only by claims-function.test.ts as the bundling entry.
export const handler = async (): Promise<{ ok: boolean }> => ({ ok: true });
