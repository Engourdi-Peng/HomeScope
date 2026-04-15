/**
 * 全局调试日志工具
 * 策略：
 * - 生产环境（非DEV）完全移除所有 debug/info 日志
 * - 保留 console.error 用于线上问题排查
 * - 提供环境判断方法供业务代码使用
 */

export const isDev = import.meta.env?.DEV === true;

/**
 * 条件性输出调试日志（仅在DEV模式生效）
 * 使用方式：debugLog('message', data)
 */
export const debugLog = (...args: unknown[]) => {
  if (isDev) {
    console.log('[HomeScope DEBUG]', ...args);
  }
};

/**
 * 条件性输出信息日志（仅在DEV模式生效）
 */
export const infoLog = (...args: unknown[]) => {
  if (isDev) {
    console.info('[HomeScope INFO]', ...args);
  }
};

/**
 * 始终输出警告日志（保留）
 */
export const warnLog = (...args: unknown[]) => {
  console.warn('[HomeScope WARN]', ...args);
};

/**
 * 始终输出错误日志（保留）
 */
export const errorLog = (...args: unknown[]) => {
  console.error('[HomeScope ERROR]', ...args);
};

/**
 * 断言工具（DEV模式下生效）
 */
export const assert = (condition: boolean, message?: string): asserts condition => {
  if (isDev && !condition) {
    throw new Error(message || 'Assertion failed');
  }
};
