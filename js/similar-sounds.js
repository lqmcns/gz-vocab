/**
 * similar-sounds.js - 发音相似词生成模块
 * 通过 Datamuse API 获取发音相似的词作为拼写干扰项
 * API 失败时使用规则化兜底生成干扰项
 */

class SimilarSoundsService {
  constructor() {
    /**
     * 本地缓存
     * 键为音节字符串，值为干扰项字符串数组
     * @type {Object.<string, string[]>}
     */
    this.cache = {};

    /**
     * 元音字母集合
     * @private
     */
    this.VOWELS = ['a', 'e', 'i', 'o', 'u'];

    /**
     * 辅音替换规则表
     * 用于规则化生成干扰项时替换发音相似的辅音
     * @private
     */
    this.CONSONANT_RULES = {
      'c': ['s', 'k'],
      's': ['z', 'c'],
      'f': ['ph'],
      'ph': ['f'],
      'k': ['c', 'q'],
      'q': ['k', 'c'],
      'w': ['v'],
      'v': ['w'],
      'z': ['s'],
      't': ['th'],
      'd': ['t'],
      'g': ['j'],
      'j': ['g'],
      'm': ['n'],
      'n': ['m'],
      'b': ['p'],
      'p': ['b'],
      'r': ['rh'],
    };
  }

  /**
   * 生成指定音节的干扰项（发音相似的词）
   * 流程：查缓存 -> 调用 Datamuse API -> 过滤 -> 随机取 -> 规则兜底
   *
   * @param {string} syllable - 目标音节
   * @param {number} count - 需要的干扰项数量，默认3
   * @returns {Promise<string[]>} 干扰项数组
   *
   * @example
   * const distractors = await similarSounds.generateDistractors('tion', 3);
   * // 可能返回 ['sion', 'cean', 'shun']
   */
  async generateDistractors(syllable, count = 3) {
    if (!syllable || typeof syllable !== 'string') {
      return [];
    }

    const key = syllable.toLowerCase().trim();
    if (!key) {
      return [];
    }

    // 1. 先查本地缓存
    if (this.cache[key]) {
      const cached = this.cache[key];
      if (cached.length >= count) {
        return shuffleArray([...cached]).slice(0, count);
      }
      // 缓存不足时，继续尝试 API 获取更多
    }

    // 2. 调用 Datamuse API
    try {
      const apiUrl = 'https://api.datamuse.com/words?sl=' +
        encodeURIComponent(key) + '&max=10';

      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error('Datamuse API 请求失败: HTTP ' + response.status);
      }

      const data = await response.json();
      const distractors = this._filterResults(key, data);

      if (distractors.length >= count) {
        // 缓存结果
        this.cache[key] = distractors;
        return shuffleArray([...distractors]).slice(0, count);
      }
    } catch (e) {
      console.warn('[SimilarSounds] API 调用失败，使用规则兜底:', e.message);
    }

    // 3. API 结果不足或失败，使用规则化兜底
    const ruleBased = this.generateRuleBasedDistractors(key, count);

    // 合并已有的缓存结果
    const allResults = [...(this.cache[key] || []), ...ruleBased];
    // 去重
    const unique = [...new Set(allResults.map(s => s.toLowerCase()))];
    // 更新缓存
    this.cache[key] = unique;

    return shuffleArray([...unique]).slice(0, count);
  }

  /**
   * 过滤 Datamuse API 返回的结果
   * 去除与原音节完全相同的项、含空格的短语、长度差异过大的项
   *
   * @private
   * @param {string} original - 原音节
   * @param {Array} results - API 返回的结果数组
   * @returns {string[]} 过滤后的干扰项数组
   */
  _filterResults(original, results) {
    if (!Array.isArray(results)) {
      return [];
    }

    const lowerOriginal = original.toLowerCase();

    return results
      .filter(item => {
        // API 返回的每项可能是 { word: 'xxx', score: ... } 或纯字符串
        const word = typeof item === 'string' ? item : (item.word || '');
        const lower = word.toLowerCase();

        // 去除与原音节完全相同的项
        if (lower === lowerOriginal) {
          return false;
        }

        // 去除含空格的短语
        if (/\s/.test(word)) {
          return false;
        }

        // 去除长度差异超过2的项
        if (Math.abs(word.length - lowerOriginal.length) > 2) {
          return false;
        }

        return true;
      })
      .map(item => {
        return typeof item === 'string' ? item : (item.word || '');
      })
      .filter(w => w.length > 0);
  }

  /**
   * 规则化生成干扰项
   * 通过元音替换和辅音替换生成发音相似的变体
   *
   * @param {string} syllable - 目标音节
   * @param {number} count - 需要的干扰项数量
   * @returns {string[]} 规则生成的干扰项数组
   *
   * @example
   * similarSounds.generateRuleBasedDistractors('tion', 3)
   * // 可能返回 ['sion', 'shon', 'teon']
   */
  generateRuleBasedDistractors(syllable, count = 3) {
    if (!syllable || typeof syllable !== 'string') {
      return [];
    }

    const lower = syllable.toLowerCase().trim();
    if (!lower) {
      return [];
    }

    const distractors = new Set();
    const chars = lower.split('');

    // 策略1：元音替换 - 遍历每个字符，如果是元音则替换为其他元音
    for (let i = 0; i < chars.length; i++) {
      if (this.VOWELS.includes(chars[i])) {
        for (const vowel of this.VOWELS) {
          if (vowel !== chars[i]) {
            const variant = chars.slice();
            variant[i] = vowel;
            const newWord = variant.join('');
            if (newWord !== lower) {
              distractors.add(newWord);
            }
            if (distractors.size >= count * 2) break;
          }
        }
        if (distractors.size >= count * 2) break;
      }
    }

    // 策略2：辅音替换 - 替换发音相似的辅音组合
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const replacements = this.CONSONANT_RULES[ch];

      if (replacements) {
        for (const replacement of replacements) {
          const variant = lower.substring(0, i) + replacement + lower.substring(i + 1);
          if (variant !== lower && variant.length > 0) {
            distractors.add(variant);
          }
          if (distractors.size >= count * 2) break;
        }
      }

      // 检查双字符辅音组合（如 ph, th, sh 等）
      if (i < chars.length - 1) {
        const pair = chars[i] + chars[i + 1];
        const pairReplacements = this.CONSONANT_RULES[pair];

        if (pairReplacements) {
          for (const replacement of pairReplacements) {
            const variant = lower.substring(0, i) + replacement + lower.substring(i + 2);
            if (variant !== lower && variant.length > 0) {
              distractors.add(variant);
            }
            if (distractors.size >= count * 2) break;
          }
        }
      }

      if (distractors.size >= count * 2) break;
    }

    // 策略3：交换相邻字符（字母互换，模拟常见拼写错误）
    for (let i = 0; i < chars.length - 1; i++) {
      const swapped = chars.slice();
      [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
      const newWord = swapped.join('');
      if (newWord !== lower) {
        distractors.add(newWord);
      }
      if (distractors.size >= count * 3) break;
    }

    // 策略4：删除/添加一个字符
    for (let i = 0; i < chars.length; i++) {
      // 删除一个字符
      const deleted = lower.substring(0, i) + lower.substring(i + 1);
      if (deleted.length > 0) {
        distractors.add(deleted);
      }
      // 在位置i后插入一个元音
      for (const vowel of this.VOWELS.slice(0, 2)) {
        const inserted = lower.substring(0, i + 1) + vowel + lower.substring(i + 1);
        distractors.add(inserted);
      }
      if (distractors.size >= count * 3) break;
    }

    // 转为数组，随机打乱后取所需数量
    const result = shuffleArray([...distractors]);
    return result.slice(0, Math.max(count, 1));
  }

  /**
   * 清除本地缓存
   */
  clearCache() {
    this.cache = {};
    console.log('[SimilarSounds] 缓存已清除');
  }
}

/* ===========================
   创建全局实例并挂载到 window
   =========================== */
window.SimilarSoundsService = SimilarSoundsService;
window.similarSounds = new SimilarSoundsService();
