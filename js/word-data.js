/**
 * word-data.js - 词库管理模块
 * 负责加载和管理高考3500词数据
 * 提供按ID查询、范围获取、搜索等功能
 */

class WordDataService {
  constructor() {
    // 词库数据（内存缓存）
    this._dictionary = null;
    // 索引数据（内存缓存）
    this._wordIndex = null;
    // 加载状态
    this._isLoading = false;
    this._loadPromise = null;
  }

  /**
   * 异步加载词库数据
   * 从 data/gk3500.json 加载完整词库到内存
   * @returns {Promise<Array>} 单词数组
   */
  async loadDictionary() {
    // 如果已加载，直接返回缓存
    if (this._dictionary) {
      return this._dictionary;
    }

    // 如果正在加载，返回同一个 Promise 避免重复请求
    if (this._loadPromise) {
      return this._loadPromise;
    }

    this._isLoading = true;
    this._loadPromise = (async () => {
      try {
        const response = await fetch('data/gk3500.json');
        if (!response.ok) {
          throw new Error(`加载词库失败: HTTP ${response.status}`);
        }
        this._dictionary = await response.json();
        console.log(`[WordData] 词库加载完成，共 ${this._dictionary.length} 个单词`);
        return this._dictionary;
      } catch (error) {
        console.error('[WordData] 加载词库失败:', error);
        this._dictionary = [];
        throw error;
      } finally {
        this._isLoading = false;
      }
    })();

    return this._loadPromise;
  }

  /**
   * 按ID获取单个单词
   * @param {number} id - 单词ID
   * @returns {object|null} 单词对象或 null
   */
  getWordById(id) {
    if (!this._dictionary || !this._dictionary.length) {
      console.warn('[WordData] 词库尚未加载');
      return null;
    }
    // 词库中 id 从1开始，数组索引从0开始
    const index = id - 1;
    if (index >= 0 && index < this._dictionary.length) {
      return this._dictionary[index];
    }
    return null;
  }

  /**
   * 按范围获取一批单词
   * @param {number} start - 起始ID（从1开始）
   * @param {number} count - 获取数量
   * @returns {Array} 单词数组
   */
  getWordsByRange(start, count) {
    if (!this._dictionary || !this._dictionary.length) {
      console.warn('[WordData] 词库尚未加载');
      return [];
    }
    const startIndex = Math.max(0, start - 1);
    const endIndex = Math.min(this._dictionary.length, startIndex + count);
    return this._dictionary.slice(startIndex, endIndex);
  }

  /**
   * 获取词库索引数据（单词ID和拼写列表）
   * 从 data/word-index.json 加载轻量索引
   * @returns {Promise<Array>} 索引数组 [{id, word}, ...]
   */
  async getWordIndex() {
    // 内存缓存
    if (this._wordIndex) {
      return this._wordIndex;
    }
    try {
      const response = await fetch('data/word-index.json');
      if (!response.ok) {
        throw new Error(`加载索引失败: HTTP ${response.status}`);
      }
      this._wordIndex = await response.json();
      return this._wordIndex;
    } catch (error) {
      console.error('[WordData] 加载索引失败:', error);
      return [];
    }
  }

  /**
   * 搜索单词（前缀匹配）
   * @param {string} query - 搜索关键词
   * @param {number} limit - 最大返回数量，默认20
   * @returns {Array} 匹配的单词数组
   */
  searchWord(query, limit = 20) {
    if (!this._dictionary || !this._dictionary.length) {
      console.warn('[WordData] 词库尚未加载');
      return [];
    }
    if (!query || typeof query !== 'string') {
      return [];
    }

    const lowerQuery = query.toLowerCase().trim();
    const results = [];

    for (let i = 0; i < this._dictionary.length && results.length < limit; i++) {
      const word = this._dictionary[i];
      // 前缀匹配（不区分大小写）
      if (word.word.toLowerCase().startsWith(lowerQuery)) {
        results.push(word);
      }
    }

    return results;
  }

  /**
   * 获取词库总词数
   * @returns {number} 总词数
   */
  getTotalCount() {
    if (this._dictionary) {
      return this._dictionary.length;
    }
    return 0;
  }

  /**
   * 检查词库是否已加载
   * @returns {boolean}
   */
  isLoaded() {
    return this._dictionary !== null && this._dictionary.length > 0;
  }

  /**
   * 根据学习进度获取待复习的单词
   * @param {Array<number>} wordIds - 需要复习的单词ID列表
   * @returns {Array} 单词对象数组
   */
  getWordsByIds(wordIds) {
    if (!this._dictionary || !this._dictionary.length) {
      return [];
    }
    return wordIds
      .map((id) => this.getWordById(id))
      .filter((word) => word !== null);
  }
}

/* ===========================
   导出为全局可用
   =========================== */
window.WordDataService = WordDataService;
