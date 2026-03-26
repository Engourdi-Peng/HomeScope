/**
 * Content Script 日志工具
 */

const DEBUG = true;

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export function log(level: LogLevel, ...args: unknown[]) {
  if (!DEBUG) return;
  const prefix = `[HomeScope CS ${new Date().toISOString().slice(11, 23)}]`;
  // eslint-disable-next-line no-console
  if (console[level]) console[level](prefix, ...args);
}

export function logPing(url: string, readyState: DocumentReadyState) {
  log('info', 'PING response:', { url, readyState });
}

export function logExtraction(extractorId: string, stage: string, confidence: number) {
  log('info', `Extraction [${extractorId}] stage=${stage} confidence=${confidence.toFixed(2)}`);
}

export function logError(code: string, details: string) {
  log('error', `ERROR [${code}]:`, details);
}
