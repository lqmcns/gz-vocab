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
    // 云端同步防抖计时器
    this._cloudSyncTimer = null;
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
      // 触发云端同步（防抖，避免频繁请求）
      this._scheduleCloudSync();
    } catch (e) {
      console.error('[ProgressStorage] 保存进度失败:', e);
    }
  }

  /**
   * 防抖同步到云端（2秒内的多次保存只同步一次）
   */
  _scheduleCloudSync() {
    // 只在登录状态下同步
    if (typeof AuthService === 'undefined' || !AuthService.isLoggedIn()) return;
    
    // 清除之前的计时器
    if (this._cloudSyncTimer) {
      clearTimeout(this._cloudSyncTimer);
    }
    
    // 2秒后执行同步
    this._cloudSyncTimer = setTimeout(() => {
      this._syncToCloud();
    }, 2000);
  }

  /**
   * 执行云端同步
   * 同步内容：学习进度 + 用户设置 + 学习会话（中途退出记录）
   */
  async _syncToCloud() {
    if (typeof AuthService === 'undefined' || !AuthService.isLoggedIn()) return;
    
    try {
      const progress = this.getAllProgress();
      const stats = this.getProgressStats();
      // 读取当前设置（合并到云端）
      const settings = (typeof settingsStorage !== 'undefined')
        ? settingsStorage.getSettings()
        : {};
      // 收集所有学习会话进度（learnflow_ 前缀的 localStorage 项）
      const learnSessions = this._collectLearnSessions();
      const data = {
        username: AuthService.getUsername(),
        learned: progress,
        stats: stats,
        settings: settings,
        learnSessions: learnSessions,
        updatedAt: new Date().toISOString(),
      };
      await AuthService.saveCloudData(data);
      console.log('[ProgressStorage] 云端同步成功（含设置和学习会话）');
    } catch (e) {
      console.warn('[ProgressStorage] 云端同步失败:', e);
    }
  }

  /**
   * 收集所有学习会话进度（localStorage 中 learnflow_ 前缀的项）
   * @returns {object} 以 key 为键的会话数据
   */
  _collectLearnSessions() {
    const sessions = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('learnflow_')) {
          const data = localStorage.getItem(key);
          if (data) {
            sessions[key] = JSON.parse(data);
          }
        }
      }
    } catch (e) {
      console.warn('[ProgressStorage] 收集学习会话失败:', e);
    }
    return sessions;
  }

  /**
   * 手动触发云端同步（用户点击"手动同步"按钮时调用）
   * 同步方向：双向（先上传本地数据，再下载云端数据合并）
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async manualSync() {
    if (typeof AuthService === 'undefined' || !AuthService.isLoggedIn()) {
      return { success: false, message: '请先登录' };
    }

    try {
      // 1. 先上传本地数据到云端
      await this._syncToCloud();

      // 2. 再从云端下载并合并
      const loaded = await this.loadFromCloud();

      if (loaded) {
        return { success: true, message: '同步成功：已上传本地数据并合并云端数据' };
      }
      return { success: true, message: '同步成功：已上传本地数据' };
    } catch (e) {
      console.warn('[ProgressStorage] 手动同步失败:', e);
      return { success: false, message: '同步失败：' + (e.message || '未知错误') };
    }
  }

  /**
   * 从云端加载学习数据和设置（登录后调用）
   */
  async loadFromCloud() {
    if (typeof AuthService === 'undefined' || !AuthService.isLoggedIn()) return false;
    
    try {
      const cloudData = await AuthService.loadCloudData();
      if (!cloudData) return false;

      let mergedSomething = false;

      // 1. 合并学习进度（取最新的）
      if (cloudData.learned) {
        const localProgress = this.getAllProgress();
        const merged = { ...localProgress };
        
        for (const [wordId, cloudEntry] of Object.entries(cloudData.learned)) {
          const localEntry = merged[wordId];
          if (!localEntry || (cloudEntry.updatedAt > localEntry.updatedAt)) {
            merged[wordId] = cloudEntry;
          }
        }
        
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(merged));
        console.log('[ProgressStorage] 云端进度加载成功，合并了', Object.keys(cloudData.learned).length, '条记录');
        mergedSomething = true;
      }

      // 2. 合并用户设置（云端有则覆盖本地，因为设置没有时间戳，以云端为准）
      if (cloudData.settings && typeof settingsStorage !== 'undefined') {
        try {
          const localSettings = settingsStorage.getSettings();
          // 合并：云端设置优先，但保留本地可能有但云端没有的字段
          const mergedSettings = { ...localSettings, ...cloudData.settings };
          localStorage.setItem(settingsStorage.STORAGE_KEY, JSON.stringify(mergedSettings));
          console.log('[ProgressStorage] 云端设置加载成功');
          mergedSomething = true;

          // 应用合并后的设置（如暗色模式、语速等）
          if (typeof restoreSettings === 'function') {
            restoreSettings();
          } else if (typeof syncSettingsUI === 'function') {
            syncSettingsUI();
          }
        } catch (e) {
          console.warn('[ProgressStorage] 应用云端设置失败:', e);
        }
      }

      // 3. 合并学习会话（中途退出记录，取最新的）
      if (cloudData.learnSessions) {
        try {
          for (const [key, cloudSession] of Object.entries(cloudData.learnSessions)) {
            const localData = localStorage.getItem(key);
            if (localData) {
              const localSession = JSON.parse(localData);
              // 取保存时间最新的
              if (cloudSession.savedAt > (localSession.savedAt || 0)) {
                localStorage.setItem(key, JSON.stringify(cloudSession));
              }
            } else {
              // 本地没有，直接写入
              localStorage.setItem(key, JSON.stringify(cloudSession));
            }
          }
          console.log('[ProgressStorage] 云端学习会话加载成功，合并了', Object.keys(cloudData.learnSessions).length, '条记录');
          mergedSomething = true;
        } catch (e) {
          console.warn('[ProgressStorage] 合并学习会话失败:', e);
        }
      }

      return mergedSomething;
    } catch (e) {
      console.warn('[ProgressStorage] 加载云端数据失败:', e);
    }
    return false;
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
   * 获取各状态的数量统计（自动将到期的 mastered 转为 review）
   * @returns {{ learning: number, mastered: number, review: number, total: number }}
   */
  getProgressStats() {
    // 先执行自动状态转换（遗忘曲线）
    this._autoUpdateReviewStatus();

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
   * 艾宾浩斯遗忘曲线复习间隔（小时）
   * 第1次复习：1小时后，第2次：9小时后，第3次：1天，第4次：2天，第5次：4天，第6次：7天，第7次：15天
   */
  get REVIEW_INTERVALS() {
    return [1, 9, 24, 48, 96, 168, 360];
  }

  /**
   * 自动更新复习状态
   * 检查所有 mastered 状态的单词，如果距离上次学习时间超过当前复习间隔，则转为 review
   * 仅在用户启用了艾宾浩斯复习曲线时执行
   */
  _autoUpdateReviewStatus() {
    // 检查是否启用了艾宾浩斯复习曲线
    if (typeof settingsStorage !== 'undefined') {
      const ebbinghausEnabled = settingsStorage.getSetting('ebbinghausReview');
      if (!ebbinghausEnabled) return; // 未启用则跳过
    }

    try {
      const progress = this.getAllProgress();
      const now = Date.now();
      let changed = false;

      for (const wordId in progress) {
        const item = progress[wordId];
        if (item.status !== 'mastered') continue;

        // 获取复习次数和上次更新时间
        const reviewCount = item.reviewCount || 0;
        const updatedAt = item.updatedAt || 0;
        const hoursPassed = (now - updatedAt) / (1000 * 60 * 60);

        // 获取当前复习间隔
        const intervalIndex = Math.min(reviewCount, this.REVIEW_INTERVALS.length - 1);
        const intervalHours = this.REVIEW_INTERVALS[intervalIndex];

        // 如果超过间隔时间，转为待复习
        if (hoursPassed >= intervalHours) {
          progress[wordId].status = 'review';
          changed = true;
        }
      }

      if (changed) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(progress));
        console.log('[ProgressStorage] 已自动更新部分单词为待复习状态');
      }
    } catch (e) {
      console.error('[ProgressStorage] 自动更新复习状态失败:', e);
    }
  }

  /**
   * 获取所有待复习的单词（status === 'review'）
   * @returns {Array<{id: number, word: string, status: string, updatedAt: number}>}
   */
  getReviewWords() {
    this._autoUpdateReviewStatus();
    const progress = this.getAllProgress();
    const result = [];
    for (const id in progress) {
      if (progress[id].status === 'review') {
        result.push({
          id: parseInt(id, 10),
          word: progress[id].word || '',
          status: 'review',
          updatedAt: progress[id].updatedAt || 0,
        });
      }
    }
    // 按更新时间排序（最久没复习的排前面）
    result.sort((a, b) => a.updatedAt - b.updatedAt);
    return result;
  }

  /**
   * 标记单词为已掌握（增加复习次数，用于遗忘曲线计算）
   * @param {number} wordId - 单词ID
   * @param {string} wordText - 单词文本
   */
  markMastered(wordId, wordText) {
    try {
      const progress = this.getAllProgress();
      const existing = progress[String(wordId)] || {};
      const reviewCount = (existing.reviewCount || 0) + 1;
      progress[String(wordId)] = {
        status: 'mastered',
        updatedAt: Date.now(),
        word: wordText || existing.word || '',
        reviewCount: reviewCount,
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(progress));
    } catch (e) {
      console.error('[ProgressStorage] 标记已掌握失败:', e);
    }
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

  /**
   * 清除所有本地学习数据（学习进度 + 学习会话）
   * 用于账号切换时清除旧账号的本地数据
   */
  clearAllLocalLearnData() {
    try {
      // 1. 清除学习进度
      localStorage.removeItem(this.STORAGE_KEY);

      // 2. 清除所有学习会话（learnflow_ 前缀的项）
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('learnflow_')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));

      console.log('[ProgressStorage] 已清除所有本地学习数据（进度 + 学习会话）');
    } catch (e) {
      console.error('[ProgressStorage] 清除本地学习数据失败:', e);
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
      learnPhrases: false,  // 是否学习短语（默认关闭，只学单个单词）
      autoPlayAudio: true,  // 学习/拼写时是否自动播放发音（默认开启）
      ebbinghausReview: false, // 是否启用艾宾浩斯遗忘曲线复习（默认关闭）
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
   * 保存后会触发云端同步（防抖，登录状态下生效）
   * @param {string} key - 设置键名
   * @param {*} value - 设置值
   */
  saveSetting(key, value) {
    try {
      const settings = this.getSettings();
      settings[key] = value;
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(settings));

      // 触发云端同步（复用 ProgressStorage 的防抖机制）
      if (typeof progressStorage !== 'undefined' && progressStorage._scheduleCloudSync) {
        progressStorage._scheduleCloudSync();
      }
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
    this.STORE_NAME = 'examples';     // 例句 store 名
    this.EXPLAIN_STORE = 'explanations'; // 单词解释 store 名
    this.DB_VERSION = 2;             // 数据库版本（v2 新增 explanations store）
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
        // 创建例句 object store（如果不存在）
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'word' });
          // 创建时间索引，用于清理过期缓存
          store.createIndex('cachedAt', 'cachedAt', { unique: false });
        }
        // v2: 创建单词解释 object store
        if (!db.objectStoreNames.contains(this.EXPLAIN_STORE)) {
          const explainStore = db.createObjectStore(this.EXPLAIN_STORE, { keyPath: 'word' });
          explainStore.createIndex('cachedAt', 'cachedAt', { unique: false });
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
        const tx = db.transaction([this.STORE_NAME, this.EXPLAIN_STORE], 'readwrite');
        tx.objectStore(this.STORE_NAME).clear();
        tx.objectStore(this.EXPLAIN_STORE).clear();
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

  /* ===========================
     单词解释缓存（explanations store）
     用于查词界面 AI 简短解释的缓存
     =========================== */

  /**
   * 缓存单词解释数据
   * @param {string} word - 单词
   * @param {object} data - 缓存数据 { explanation, phonetic, pos, translation }
   * @returns {Promise<void>}
   */
  async cacheExplanation(word, data) {
    try {
      const db = await this._openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.EXPLAIN_STORE, 'readwrite');
        const store = tx.objectStore(this.EXPLAIN_STORE);
        const record = {
          word: word,
          data: data,
          cachedAt: Date.now(),
        };
        store.put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = (event) => {
          console.error('[CacheStorage] 解释缓存写入失败:', event.target.error);
          reject(event.target.error);
        };
      });
    } catch (e) {
      console.error('[CacheStorage] 缓存解释异常:', e);
    }
  }

  /**
   * 获取缓存的单词解释数据
   * @param {string} word - 单词
   * @returns {Promise<object|null>}
   */
  async getCachedExplanation(word) {
    try {
      const db = await this._openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.EXPLAIN_STORE, 'readonly');
        const store = tx.objectStore(this.EXPLAIN_STORE);
        const request = store.get(word);
        request.onsuccess = () => {
          const result = request.result;
          resolve(result ? result.data : null);
        };
        request.onerror = (event) => {
          console.error('[CacheStorage] 解释缓存读取失败:', event.target.error);
          reject(event.target.error);
        };
      });
    } catch (e) {
      console.error('[CacheStorage] 获取解释缓存异常:', e);
      return null;
    }
  }

  /**
   * 清除指定单词的解释缓存
   * @param {string} word - 单词
   * @returns {Promise<void>}
   */
  async clearExplanationEntry(word) {
    try {
      const db = await this._openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.EXPLAIN_STORE, 'readwrite');
        const store = tx.objectStore(this.EXPLAIN_STORE);
        store.delete(word);
        tx.oncomplete = () => resolve();
        tx.onerror = (event) => {
          console.error('[CacheStorage] 删除解释缓存失败:', event.target.error);
          reject(event.target.error);
        };
      });
    } catch (e) {
      console.error('[CacheStorage] 删除解释缓存异常:', e);
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
   SearchHistoryStorage - 查词历史存储（localStorage）
   记录用户在查词界面查过的单词，支持折叠展示
   =========================== */
class SearchHistoryStorage {
  constructor() {
    this.STORAGE_KEY = 'vocab-search-history';
    /** 最多保留的查词记录条数 */
    this.MAX_RECORDS = 50;
  }

  /**
   * 添加一条查词记录（去重，最新置顶）
   * @param {string} word - 查询的单词
   */
  addRecord(word) {
    if (!word || typeof word !== 'string') return;
    const trimmed = word.trim();
    if (!trimmed) return;

    try {
      const history = this.getHistory();
      // 去重：移除已存在的相同记录（不区分大小写）
      const filtered = history.filter(
        (w) => w.toLowerCase() !== trimmed.toLowerCase()
      );
      // 最新置顶
      filtered.unshift(trimmed);
      // 超出上限时移除末尾
      if (filtered.length > this.MAX_RECORDS) {
        filtered.splice(this.MAX_RECORDS);
      }
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(filtered));
    } catch (e) {
      console.error('[SearchHistoryStorage] 保存查词记录失败:', e);
    }
  }

  /**
   * 获取查词历史
   * @returns {string[]} 查词记录数组（最新在前）
   */
  getHistory() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('[SearchHistoryStorage] 读取历史失败:', e);
      return [];
    }
  }

  /**
   * 删除单条查词记录
   * @param {string} word - 要删除的单词
   */
  removeRecord(word) {
    if (!word) return;
    try {
      const history = this.getHistory();
      const filtered = history.filter(
        (w) => w.toLowerCase() !== word.toLowerCase()
      );
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(filtered));
    } catch (e) {
      console.error('[SearchHistoryStorage] 删除记录失败:', e);
    }
  }

  /**
   * 清空所有查词历史
   */
  clearHistory() {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
      console.log('[SearchHistoryStorage] 查词历史已清空');
    } catch (e) {
      console.error('[SearchHistoryStorage] 清空历史失败:', e);
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
window.SearchHistoryStorage = SearchHistoryStorage;
