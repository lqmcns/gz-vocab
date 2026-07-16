/**
 * syllable.js - 音节拆分模块
 * 封装 hyphen 库，提供英语单词的音节拆分功能
 * 依赖：hyphen 库（已在 index.html 通过 CDN 加载）
 */

class SyllableService {
  constructor() {
    /**
     * hyphenator 实例
     * 通过 createHyphenator 初始化，使用美国英语断字模式
     * @private
     */
    this.hyphenator = null;

    /**
     * 异常单词校正表
     * 手动维护的高频不规则音节拆分，优先级高于 hyphen 库结果
     * 键为小写单词，值为用连字符分隔的音节字符串
     * @type {Object.<string, string>}
     */
    this.EXCEPTIONS = {
      'business': 'busi-ness',
      'different': 'dif-fer-ent',
      'interesting': 'in-ter-est-ing',
      'comfortable': 'com-fort-a-ble',
      'temperature': 'tem-per-a-ture',
      'definitely': 'def-i-nite-ly',
      'separate': 'sep-a-rate',
      'experience': 'ex-pe-ri-ence',
      'immediately': 'im-me-di-ate-ly',
      'necessary': 'nec-es-sa-ry',
      'particularly': 'par-tic-u-lar-ly',
      'restaurant': 'res-tau-rant',
      'unfortunately': 'un-for-tu-nate-ly',
      'remembrance': 're-mem-brance',
      'extraordinary': 'ex-traor-di-nar-y',
      'accommodate': 'ac-com-mo-date',
      'occurrence': 'oc-cur-rence',
      'irresistible': 'ir-re-sist-i-ble',
      'responsibility': 're-spon-si-bil-i-ty',
      'communicate': 'com-mu-ni-cate',
      'environment': 'en-vi-ron-ment',
      'government': 'gov-ern-ment',
      'independent': 'in-de-pend-ent',
      'literature': 'lit-er-a-ture',
      'privilege': 'priv-i-lege',
      'recommend': 'rec-om-mend',
      'secretary': 'sec-re-tar-y',
      'technology': 'tech-nol-o-gy',
    };

    // 初始化 hyphenator
    this._initHyphenator();
  }

  /**
   * 初始化 hyphenator 实例
   * 使用 en-us 断字模式，同步模式
   * @private
   */
  _initHyphenator() {
    try {
      // 检查 hyphen 库是否已加载
      if (typeof createHyphenator !== 'function') {
        console.warn('[SyllableService] hyphen 库未加载，将使用简单规则兜底');
        this.hyphenator = null;
        return;
      }
      if (typeof hyphenationPatternsEnUs === 'undefined') {
        console.warn('[SyllableService] hyphenationPatternsEnUs 模式未加载，将使用简单规则兜底');
        this.hyphenator = null;
        return;
      }

      // 创建同步模式的 hyphenator
      this.hyphenator = createHyphenator(hyphenationPatternsEnUs, {
        async: false,
        hyphenChar: '-',
      });
    } catch (e) {
      console.error('[SyllableService] hyphenator 初始化失败:', e);
      this.hyphenator = null;
    }
  }

  /**
   * 拆分单词为音节数组
   * 优先级：异常表 > hyphen 库 > 简单规则兜底
   *
   * @param {string} word - 要拆分的单词
   * @returns {string[]} 音节数组，如 "humanity" -> ["hu", "man", "i", "ty"]
   *
   * @example
   * syllableService.split('business')    // ["busi", "ness"]
   * syllableService.split('humanity')   // ["hu", "man", "i", "ty"]
   * syllableService.split('cat')         // ["cat"]
   * syllableService.split('')            // []
   */
  split(word) {
    if (!word || typeof word !== 'string') {
      return [];
    }

    const trimmed = word.trim().toLowerCase();
    if (!trimmed) {
      return [];
    }

    // 1. 先查异常校正表
    if (this.EXCEPTIONS[trimmed]) {
      return this.EXCEPTIONS[trimmed].split('-');
    }

    // 2. 使用 hyphen 库拆分
    if (this.hyphenator) {
      try {
        const hyphenated = this.hyphenator(trimmed);
        if (hyphenated && hyphenated.includes('-')) {
          const syllables = hyphenated.split('-').filter(s => s.length > 0);
          // 验证拼接后与原单词一致
          if (syllables.join('') === trimmed) {
            return syllables;
          }
        }
      } catch (e) {
        console.warn('[SyllableService] hyphen 拆分失败:', trimmed, e);
      }
    }

    // 3. 简单规则兜底
    return this._fallbackSplit(trimmed);
  }

  /**
   * 简单规则兜底拆分
   * 基于元音位置进行基本的音节切分
   * @private
   * @param {string} word - 小写单词
   * @returns {string[]} 音节数组
   */
  _fallbackSplit(word) {
    // 太短的单词不拆分
    if (word.length <= 3) {
      return [word];
    }

    const syllables = [];
    let current = '';
    const vowels = 'aeiouy';

    for (let i = 0; i < word.length; i++) {
      const ch = word[i];
      current += ch;

      // 遇到元音后，如果下一个辅音连续块之后还有元音，则在此处切分
      if (vowels.includes(ch)) {
        // 看后续是否有连续辅音后跟元音
        let j = i + 1;
        let consonantsAfter = '';
        while (j < word.length && !vowels.includes(word[j])) {
          consonantsAfter += word[j];
          j++;
        }

        // 如果后面还有元音（说明还有至少一个音节）
        if (j < word.length && consonantsAfter.length > 0) {
          // 辅音连缀一般跟着下一个音节，但保留一个给当前音节
          if (consonantsAfter.length > 1) {
            current += consonantsAfter[0];
            i += 1; // 多消耗一个辅音
          }
          syllables.push(current);
          current = '';
        }
      }
    }

    // 处理剩余部分
    if (current) {
      syllables.push(current);
    }

    // 如果拆分结果只有一段或者拼接不匹配，返回整个单词
    if (syllables.length <= 1 || syllables.join('') !== word) {
      return [word];
    }

    return syllables;
  }

  /**
   * 为拼写训练生成音节分组
   * 对于1-2个音节的短单词，返回整个单词作为单一元素（不适合拆分练习）
   * 对于3个及以上音节的单词，返回拆分后的音节数组
   *
   * @param {string} word - 要拆分的单词
   * @returns {string[]} 音节分组数组
   *
   * @example
   * syllableService.splitForSpelling('cat')       // ["cat"]  (太短，不拆分)
   * syllableService.splitForSpelling('open')      // ["open"] (2音节，不拆分)
   * syllableService.splitForSpelling('humanity')  // ["hu", "man", "i", "ty"]
   * syllableService.splitForSpelling('beautiful')  // ["beau", "ti", "ful"]
   */
  splitForSpelling(word) {
    if (!word || typeof word !== 'string') {
      return [];
    }

    const syllables = this.split(word);

    // 1-2个音节的单词不适合拆分拼写训练，返回整个单词
    if (syllables.length <= 2) {
      return [word.trim().toLowerCase()];
    }

    return syllables;
  }
}

/* ===========================
   创建全局实例并挂载到 window
   =========================== */
window.SyllableService = SyllableService;
window.syllableService = new SyllableService();
