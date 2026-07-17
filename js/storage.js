/**
 * storage.js - 存储层
 * 封装 localStorage 和 IndexedDB 操作
 * 提供进度存储、设置存储和缓存存储三类
 */

/* ===========================
   ProgressStorage - 学习进度存储（localStorage）
   存储每个单词的学习状态
   status: 'learning' | 'mastered' | 'review'
   =========================== */
class ProgressStorage {
  constructor() {
    // localStorage 键名
    this.STORAGE_KEY = 'vocab-progress';
  }

  /**
   * 保存单词学习进度
   * @param {number} wordId - 单词ID
   * @param {'learning'|'mastered'|'review'} status - 学习状态
   * @param {string} [wordText] - 单词文本（可选，用于复习时查找教材单词）
   */
  saveProgress(wordId, status, wordText) {
    try {
      const progress = this.getAllProgress();
      const existing = progress[String(wordId)] || {};
      progress[String(wordId)] = {
        status: status,
        updatedAt: Date.now(),
        word: wordText || existing.word || '',  // 保存单词文本，用于跨数据源查找
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(progress));
    } catch (e) {
      console.error('[ProgressStorage] 保存进度失败:', e);
    }
  }

  /**
   * 获取单个单词的进度
   * @param {number} wordId - 单词ID
   * @returns {object|null} 进度对象 { status, updatedAt } 或 null
   */
  getProgress(wordId) {
    try {
      const progress = this.getAllProgress();
      return progress[String(wordId)] || null;
    } catch (e) {
      console.error('[ProgressStorage] 获取进度失败:', e);
      return null;
    }
  }

  /**
   * 获取所有学习进度
   * @returns {object} 以 wordId 为键的进度对象
   */
  getAllProgress() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      console.error('[ProgressStorage] 读取进度失败:', e);
      return {};
    }
  }

  /**
   * 根据单词文本查询学习状态
   * 进度以 wordId（数字）为键存储，这里通过 wordService 反查单词文本进行匹配
   * @param {string} word - 单词文本
   * @returns {string|null} 学习状态（'learning'|'mastered'|'review'），未学习返回 null
   */
  getWordStatus(word) {
    if (!word) return null;
    try {
      const progress = this.getAllProgress();
      const lowerWord = String(word).toLowerCase().trim();
      if (!lowerWord) return null;
      // 遍历所有学习进度，通过 wordService 比对单词文本
      for (const wordId in progress) {
        const entry = progress[wordId];
        if (!entry || !entry.status) continue;
        if (window.wordService && typeof wordService.isLoaded === 'function' && wordService.isLoaded()) {
          const wordObj = wordService.getWordById(parseInt(wordId, 10));
          if (wordObj && wordObj.word && wordObj.word.toLowerCase() === lowerWord) {
            return entry.status;
          }
        }
      }
      return null;
    } catch (e) {
      console.error('[ProgressStorage] 获取单词状态失败:', e);
      return null;
    }
  }

  /**
   * 获取各状态的数量统计
   * @returns {{ learning: number, mastered: number, review: number, total: number }}
   */
  getProgressStats() {
    const progress = this.getAllProgress();
    const stats = { learning: 0, mastered: 0, review: 0, total: 0 };
    Object.values(progress).forEach((item) => {
      if (stats.hasOwnProperty(item.status)) {
        stats[item.status]++;
      }
      stats.total++;
    });
    return stats;
  }

  /**
   * 清除所有学习进度
   */
  clearProgress() {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
      console.log('[ProgressStorage] 学习进度已清除');
    } catch (e) {
      console.error('[ProgressStorage] 清除进度失败:', e);
    }
  }
}

/* ===========================
   SettingsStorage - 设置存储（localStorage）
   管理应用设置项
   =========================== */
class SettingsStorage {
  constructor() {
    this.STORAGE_KEY = 'vocab-settings';
    // 默认设置
    this.DEFAULTS = {
      batchSize: 5,        // 每批学习单词数
      darkMode: false,     // 暗色模式
      voiceRate: 0.85,     // 语音朗读速度
      spellMode: 'partial', // 拼写模式：'partial' | 'full' | 'manual'
    };
  }

  /**
   * 获取所有设置（合并默认值）
   * @returns {object} 设置对象
   */
  getSettings() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      const saved = data ? JSON.parse(data) : {};
      // 与默认值合并，确保所有字段都有值
      return { ...this.DEFAULTS, ...saved };
    } catch (e) {
      console.error('[SettingsStorage] 读取设置失败:', e);
      return { ...this.DEFAULTS };
    }
  }

  /**
   * 保存单个设置项
   * @param {string} key - 设置键名
   * @param {*} value - 设置值
   */
  saveSetting(key, value) {
    try {
      const settings = this.getSettings();
      settings[key] = value;
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('[SettingsStorage] 保存设置失败:', e);
    }
  }

  /**
   * 获取单个设置项
   * @param {string} key - 设置键名
   * @returns {*} 设置值
   */
  getSetting(key) {
    const settings = this.getSettings();
    return settings[key] !== undefined ? settings[key] : this.DEFAULTS[key];
  }

  /**
   * 重置所有设置为默认值
   */
  resetSettings() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.DEFAULTS));
    } catch (e) {
      console.error('[SettingsStorage] 重置设置失败:', e);
    }
  }
}

/* ===========================
   CacheStorage - 例句缓存存储（IndexedDB）
   缓存 AI 生成的例句数据，避免重复请求
   =========================== */
class CacheStorage {
  constructor() {
    this.DB_NAME = 'vocab-cache';     // 数据库名
    this.STORE_NAME = 'examples';     // store 名
    this.DB_VERSION = 1;             // 数据库版本
    this.db = null;                   // 数据库实例引用
  }

  /**
   * 初始化/打开数据库连接
   * @returns {Promise<IDBDatabase>}
   */
  _openDB() {
    // 如果已有打开的连接，直接返回
    if (this.db) {
      return Promise.resolve(this.db);
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        // 创建 object store（如果不存在）
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'word' });
          // 创建时间索引，用于清理过期缓存
          store.createIndex('cachedAt', 'cachedAt', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('[CacheStorage] 打开数据库失败:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * 缓存例句数据
   * @param {string} word - 单词
   * @param {object} data - 缓存数据
   * @returns {Promise<void>}
   */
  async cacheExample(word, data) {
    try {
      const db = await this._openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE_NAME, 'readwrite');
        const store = tx.objectStore(this.STORE_NAME);
        const record = {
          word: word,
          data: data,
          cachedAt: Date.now(),
        };
        store.put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = (event) => {
          console.error('[CacheStorage] 缓存写入失败:', event.target.error);
          reject(event.target.error);
        };
      });
    } catch (e) {
      console.error('[CacheStorage] 缓存例句异常:', e);
    }
  }

  /**
   * 获取缓存的例句数据
   * @param {string} word - 单词
   * @returns {Promise<object|null>} 缓存数据或 null
   */
  async getCachedExample(word) {
    try {
      const db = await this._openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE_NAME, 'readonly');
        const store = tx.objectStore(this.STORE_NAME);
        const request = store.get(word);
        request.onsuccess = () => {
          const result = request.result;
          resolve(result ? result.data : null);
        };
        request.onerror = (event) => {
          console.error('[CacheStorage] 缓存读取失败:', event.target.error);
          reject(event.target.error);
        };
      });
    } catch (e) {
      console.error('[CacheStorage] 获取缓存异常:', e);
      return null;
    }
  }

  /**
   * 清除指定单词的缓存
   * @param {string} word - 单词
   * @returns {Promise<void>}
   */
  async clearCacheEntry(word) {
    try {
      const db = await this._openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE_NAME, 'readwrite');
        const store = tx.objectStore(this.STORE_NAME);
        store.delete(word);
        tx.oncomplete = () => resolve();
        tx.onerror = (event) => {
          console.error('[CacheStorage] 删除缓存失败:', event.target.error);
          reject(event.target.error);
        };
      });
    } catch (e) {
      console.error('[CacheStorage] 删除缓存异常:', e);
    }
  }

  /**
   * 清除所有缓存数据
   * @returns {Promise<void>}
   */
  async clearCache() {
    try {
      // 如果数据库从未打开过，直接删除整个数据库
      if (!this.db) {
        return new Promise((resolve) => {
          const deleteReq = indexedDB.deleteDatabase(this.DB_NAME);
          deleteReq.onsuccess = () => {
            console.log('[CacheStorage] 数据库已删除');
            resolve();
          };
          deleteReq.onerror = () => {
            console.warn('[CacheStorage] 删除数据库失败，可能不存在');
            resolve();
          };
          deleteReq.onblocked = () => {
            console.warn('[CacheStorage] 删除数据库被阻塞');
            resolve();
          };
        });
      }

      const db = await this._openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE_NAME, 'readwrite');
        const store = tx.objectStore(this.STORE_NAME);
        store.clear();
        tx.oncomplete = () => {
          console.log('[CacheStorage] 缓存已清除');
          resolve();
        };
        tx.onerror = (event) => {
          console.error('[CacheStorage] 清除缓存失败:', event.target.error);
          reject(event.target.error);
        };
      });
    } catch (e) {
      console.error('[CacheStorage] 清除缓存异常:', e);
      // 不抛出错误，让调用方正常处理
    }
  }
}

/* ===========================
   VocabTestStorage - 词汇量检测记录存储（localStorage）
   保存历次词汇量检测的结果数据，用于动态难度推荐
   =========================== */
class VocabTestStorage {
  constructor() {
    this.STORAGE_KEY = 'vocab-test-results';
    /** 最多保留的检测记录条数 */
    this.MAX_RECORDS = 20;
  }

  /**
   * 保存一次检测结果
   * @param {object} result - 检测结果
   * @param {number} result.estimatedVocab - 预估词汇量
   * @param {number} result.accuracy - 正确率（百分比）
   * @param {number} result.testTime - 测试用时（秒）
   * @param {number} result.correctCount - 正确数
   * @param {number} result.totalCount - 总题数
   * @param {number} result.timestamp - 时间戳
   */
  saveResult(result) {
    try {
      const history = this.getHistory();
      history.push(result);
      // 超出上限时移除最早的记录
      if (history.length > this.MAX_RECORDS) {
        history.splice(0, history.length - this.MAX_RECORDS);
      }
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(history));
    } catch (e) {
      console.error('[VocabTestStorage] 保存检测结果失败:', e);
    }
  }

  /**
   * 获取最近一次检测结果
   * @returns {object|null} 最近一次结果，没有则返回 null
   */
  getLatestResult() {
    try {
      const history = this.getHistory();
      if (history.length === 0) return null;
      return history[history.length - 1];
    } catch (e) {
      console.error('[VocabTestStorage] 获取最近结果失败:', e);
      return null;
    }
  }

  /**
   * 获取所有检测历史
   * @returns {object[]} 检测结果数组（按时间正序）
   */
  getHistory() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('[VocabTestStorage] 读取历史失败:', e);
      return [];
    }
  }

  /**
   * 清除所有检测记录
   */
  clearResults() {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
      console.log('[VocabTestStorage] 检测记录已清除');
    } catch (e) {
      console.error('[VocabTestStorage] 清除记录失败:', e);
    }
  }
}

/* ===========================
   导出为全局可用
   =========================== */
window.ProgressStorage = ProgressStorage;
window.SettingsStorage = SettingsStorage;
window.CacheStorage = CacheStorage;
window.VocabTestStorage = VocabTestStorage;
