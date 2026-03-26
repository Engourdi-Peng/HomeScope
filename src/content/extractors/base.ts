/**
 * 提取器接口定义
 * Layer C（数据提取层）的核心抽象
 */

import type { ExtractedListingData } from '../../shared/types/analysis';
import type { PropertySignals } from '../detectors/propertySignals';

export type ExtractionStage = 'initial' | 'delayed' | 'final';

export interface ExtractContext {
  document: Document;
  url: URL;
  signals: PropertySignals;
  stage: ExtractionStage;
}

export interface ListingExtractor {
  /** 唯一标识符 */
  id: string;
  /** 判断当前 URL / 信号是否由本 extractor 处理 */
  canHandle(url: URL, signals: PropertySignals): boolean;
  /** 执行提取逻辑 */
  extract(ctx: ExtractContext): Promise<Partial<ExtractedListingData> | null>;
}
