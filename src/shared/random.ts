/** random hex from the platform CSPRNG (crypto.getRandomValues; available in Electron renderer, main and Node 20+) */
export const randomToken = (bytes = 6) => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('')
