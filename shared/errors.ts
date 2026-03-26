/**
 * Content Script 通信错误码
 * 接入层错误 / 页面层错误 / 提取层错误 / 通信层错误
 */

export enum ExtractionErrorCode {
  // 接入层错误
  CS_NOT_INJECTED = 'CS_NOT_INJECTED',
  NO_HOST_PERMISSION = 'NO_HOST_PERMISSION',
  TAB_UNAVAILABLE = 'TAB_UNAVAILABLE',

  // 页面层错误
  DOM_NOT_READY = 'DOM_NOT_READY',
  PAGE_CHANGED_DURING_EXTRACTION = 'PAGE_CHANGED_DURING_EXTRACTION',

  // 提取层错误
  NO_IMAGES_FOUND = 'NO_IMAGES_FOUND',
  NO_DESCRIPTION_FOUND = 'NO_DESCRIPTION_FOUND',
  INSUFFICIENT_PROPERTY_SIGNALS = 'INSUFFICIENT_PROPERTY_SIGNALS',

  // 通信层错误
  MESSAGE_TIMEOUT = 'MESSAGE_TIMEOUT',
  INVALID_RESPONSE_SHAPE = 'INVALID_RESPONSE_SHAPE',
}

export interface ExtractionError {
  code: ExtractionErrorCode;
  message: string;
  details?: string;
}

export const ERROR_MESSAGES: Record<ExtractionErrorCode, { user: string; dev: string }> = {
  [ExtractionErrorCode.CS_NOT_INJECTED]: {
    user: "Couldn't access this page",
    dev: 'Content script not injected and runtime injection failed',
  },
  [ExtractionErrorCode.NO_HOST_PERMISSION]: {
    user: "Couldn't access this page",
    dev: 'No host permission for this URL',
  },
  [ExtractionErrorCode.TAB_UNAVAILABLE]: {
    user: 'Tab unavailable',
    dev: 'Could not get active tab',
  },
  [ExtractionErrorCode.DOM_NOT_READY]: {
    user: 'Page is still loading, retry in a moment',
    dev: 'DOM not ready, readyState is not complete',
  },
  [ExtractionErrorCode.PAGE_CHANGED_DURING_EXTRACTION]: {
    user: 'Page changed during extraction, please retry',
    dev: 'URL changed mid-extraction',
  },
  [ExtractionErrorCode.NO_IMAGES_FOUND]: {
    user: "Couldn't find any property images on this page",
    dev: 'Image extraction returned empty',
  },
  [ExtractionErrorCode.NO_DESCRIPTION_FOUND]: {
    user: "Couldn't find property description",
    dev: 'Description extraction returned empty',
  },
  [ExtractionErrorCode.INSUFFICIENT_PROPERTY_SIGNALS]: {
    user: "This doesn't look like a property listing page",
    dev: 'Property confidence score too low',
  },
  [ExtractionErrorCode.MESSAGE_TIMEOUT]: {
    user: 'Page is still loading, retry in a moment',
    dev: 'No response from content script within timeout',
  },
  [ExtractionErrorCode.INVALID_RESPONSE_SHAPE]: {
    user: 'Received invalid data from page',
    dev: 'Response shape does not match expected schema',
  },
};

export function getUserErrorMessage(code: ExtractionErrorCode): string {
  return ERROR_MESSAGES[code]?.user ?? 'Something went wrong';
}

export function getDevErrorMessage(code: ExtractionErrorCode): string {
  return ERROR_MESSAGES[code]?.dev ?? 'Unknown error';
}
