/**
 * 地址解析模块
 * 从房源地址中提取结构化字段
 * 
 * 输入示例: "32 Bluebottle Parade, Rockbank, VIC 3335, AU"
 * 输出示例: { street: "32 Bluebottle Parade", suburb: "Rockbank", state: "VIC", postcode: "3335", country: "AU" }
 */

export interface ParsedAddress {
  street: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  raw: string;
}

// 澳大利亚州代码
const AU_STATES = ['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'];

// 州代码正则: 匹配 "VIC 3335" 或 "VIC  3335" 等格式
const STATE_POSTCODE_PATTERN = /^((?:VIC|NSW|QLD|SA|WA|TAS|ACT|NT)\s*?)(\d{4})$/i;

// 国家代码识别 (常见格式)
const COUNTRY_CODES = ['AU', 'NZ', 'US', 'UK', 'CA'];

/**
 * 清洗地址段 - 去除多余空格
 */
function cleanPart(part: string): string {
  return part.trim().replace(/\s+/g, ' ');
}

/**
 * 解析第三段中的 state 和 postcode
 * 输入如 "VIC 3335"，输出 { state: "VIC", postcode: "3335" }
 */
function parseStateAndPostcode(part: string): { state: string | null; postcode: string | null } {
  const trimmed = cleanPart(part);
  const match = trimmed.match(STATE_POSTCODE_PATTERN);
  
  if (match) {
    return {
      state: match[1].trim().toUpperCase(),
      postcode: match[2],
    };
  }
  
  return { state: null, postcode: null };
}

/**
 * 判断是否是国家代码
 */
function isCountryCode(part: string): boolean {
  const cleaned = cleanPart(part).toUpperCase();
  return cleaned.length === 2 && COUNTRY_CODES.includes(cleaned);
}

/**
 * 解析地址字符串，提取结构化字段
 * 
 * @param address - 原始地址字符串
 * @returns 解析后的地址对象，所有字段均为 string | null
 */
export function parseAddress(address: string | null | undefined): ParsedAddress {
  const raw = address || '';
  
  // Fallback 空值
  const result: ParsedAddress = {
    street: null,
    suburb: null,
    state: null,
    postcode: null,
    country: null,
    raw,
  };
  
  if (!raw.trim()) {
    return result;
  }
  
  // 按逗号分段
  const parts = raw.split(',').map(cleanPart).filter(Boolean);
  
  if (parts.length === 0) {
    return result;
  }
  
  // 1. 第一段作为 street
  if (parts[0]) {
    result.street = parts[0];
  }
  
  // 2. 第二段优先作为 suburb
  if (parts.length >= 2 && parts[1]) {
    const secondPart = parts[1];
    
    // 检查第二段是否包含 state+postcode 格式
    const statePostcodeMatch = secondPart.match(STATE_POSTCODE_PATTERN);
    if (statePostcodeMatch) {
      // 第二段是 "VIC 3335" 格式，说明没有 suburb
      result.state = statePostcodeMatch[1].trim().toUpperCase();
      result.postcode = statePostcodeMatch[2];
    } else if (!isCountryCode(secondPart)) {
      // 正常情况：第二段是 suburb
      result.suburb = secondPart;
    }
  }
  
  // 3. 第三段解析 state 和 postcode
  if (parts.length >= 3 && parts[2]) {
    const thirdPart = parts[2];
    
    // 如果 suburb 未设置，尝试从第三段提取
    if (!result.suburb && !isCountryCode(thirdPart)) {
      const parsed = parseStateAndPostcode(thirdPart);
      if (!parsed.state) {
        // 第三段不是 state+postcode，可能是 suburb
        result.suburb = thirdPart;
      } else {
        // 有 state+postcode
        result.state = parsed.state;
        result.postcode = parsed.postcode;
      }
    } else {
      // suburb 已设置，直接解析 state 和 postcode
      const parsed = parseStateAndPostcode(thirdPart);
      if (parsed.state) result.state = parsed.state;
      if (parsed.postcode) result.postcode = parsed.postcode;
    }
  }
  
  // 4. 如果 state/postcode 仍未解析，尝试从第二段检测
  if (!result.state || !result.postcode) {
    if (parts.length >= 2 && parts[1]) {
      const secondPart = parts[1];
      const parsed = parseStateAndPostcode(secondPart);
      
      // 如果之前没有 suburb 且第二段不是纯 state+postcode
      if (!result.suburb && parsed.state && !parsed.postcode) {
        result.suburb = secondPart;
      }
      
      if (parsed.state) result.state = parsed.state;
      if (parsed.postcode) result.postcode = parsed.postcode;
    }
  }
  
  // 5. 第四段作为 country
  if (parts.length >= 4 && parts[3]) {
    if (isCountryCode(parts[3])) {
      result.country = cleanPart(parts[3]).toUpperCase();
    }
  }
  
  // 如果最后一段看起来像国家代码，即使不是第四段也识别
  if (!result.country && parts.length >= 2) {
    const lastPart = parts[parts.length - 1];
    if (isCountryCode(lastPart)) {
      result.country = cleanPart(lastPart).toUpperCase();
    }
  }
  
  return result;
}

/**
 * 便捷函数：只提取 suburb
 */
export function extractSuburb(address: string | null | undefined): string | null {
  return parseAddress(address).suburb;
}
