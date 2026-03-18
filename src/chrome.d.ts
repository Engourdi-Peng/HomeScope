/**
 * Minimal type declarations for Chrome Extension API.
 * Used when the web app is opened in a tab by the extension (e.g. /login?from=extension).
 */
interface ChromeRuntimeMessage {
  action: string;
  user?: { id: string; email?: string };
}

declare global {
  interface ChromeStorageArea {
    set(items: Record<string, unknown>): Promise<void>;
    get(keys?: string[]): Promise<Record<string, unknown>>;
  }

  interface ChromeStorage {
    local: ChromeStorageArea;
  }

  interface ChromeRuntime {
    sendMessage(message: ChromeRuntimeMessage): Promise<{ success?: boolean; error?: string }>;
  }

  const chrome: {
    storage: ChromeStorage;
    runtime: ChromeRuntime;
  } | undefined;
}

export {};
