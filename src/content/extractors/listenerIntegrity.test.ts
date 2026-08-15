/**
 * Contract tests for the content script listener wiring in
 * `extension/content.js`. The previous regression "Could not establish
 * connection. Receiving end does not exist." traced back to a content
 * script that had run but failed to register a real `chrome.runtime.
 * onMessage` listener. This test pins the invariants that must hold so
 * future refactors cannot silently regress to a "registered but empty"
 * listener or to swallowing initialization errors.
 *
 * Why source-text contract tests:
 *   - vitest config uses `environment: 'node'` (no jsdom).
 *   - The locked-in contract is about real listener registration and
 *     no-fallback-listener behavior, both observable in source.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CONTENT_JS = resolve(__dirname, '..', '..', '..', 'extension', 'content.js');

function readContent(): string {
  return readFileSync(CONTENT_JS, 'utf8');
}

describe('Content script listener integrity', () => {
  it('registers exactly one chrome.runtime.onMessage listener bound to the real handler', () => {
    const src = readContent();
    const matches = src.match(/chrome\.runtime\.onMessage\.addListener\s*\(\s*handleMessage\s*\)/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('does NOT introduce a no-op or empty fallback listener', () => {
    const src = readContent();
    // Empty listeners (handleMessage body replaced with ()=>{} or function(){})
    // would silently absorb messages and hide "Could not establish connection".
    expect(src).not.toMatch(/chrome\.runtime\.onMessage\.addListener\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/);
    expect(src).not.toMatch(/chrome\.runtime\.onMessage\.addListener\s*\(\s*function\s*\(\s*\)\s*\{\s*\}\s*\)/);
    // No listener registered against a stub function name that returns void.
    const registeredListeners = src.match(
      /chrome\.runtime\.onMessage\.addListener\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/
    );
    if (registeredListeners) {
      const handlerName = registeredListeners[1];
      expect(handlerName).toBe('handleMessage');
    }
  });

  it('preserves the singleton guard so duplicate injections bail out before listeners attach', () => {
    const src = readContent();
    expect(src).toMatch(/__HS_CONTENT_LOADED__/);
    // The guard MUST be checked before the listener registration line.
    const guardIndex = src.search(/__HS_CONTENT_LOADED__/);
    const listenerIndex = src.search(/chrome\.runtime\.onMessage\.addListener/);
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(listenerIndex).toBeGreaterThan(guardIndex);
  });

  it('does NOT swallow top-level initialization errors silently', () => {
    const src = readContent();
    // The IIFE must remain a single block; we forbid adding a wrapper that
    // try/catches the entire body without re-throwing, which would mask real
    // failures and surface as "Could not establish connection" downstream.
    expect(src).not.toMatch(
      /try\s*\{\s*\(\s*function\s*\(\)\s*\{[\s\S]*?\}\s*\)\s*\(\s*\)\s*;\s*\}\s*catch/
    );
    // The trailing IIFE close MUST still exist.
    expect(src).toMatch(/\}\)\s*\(\s*\)\s*;\s*\/\/ End of IIFE/);
  });

  it('PONG case in handleMessage still returns synchronously to allow connection check', () => {
    const src = readContent();
    expect(src).toMatch(/case\s+'PONG':[\s\S]*?sendResponse\(\{\s*ready:\s*true/);
  });
});
