/**
 * textbook-service.js - 教材数据服务
 * 负责加载和管理教材词汇数据
 * 1. data/textbook-units.json - 教材单元结构
 * 2. data/textbook-dictionary.json - 教材单词词典（含音标、释义）
 * 依赖：WordDataService（全局 wordService 实例）
 */

class TextbookService {
  constructor() {
    this._data = null;        // 教材单元结构
    this._dict = null;        // 教材单词词典
    this._dictMap = null;     // 单词映射表（小写 -> 词典条目）
    this._isLoading = false;
    this._loadPromise = null;
  }

  /**
   * 异步加载教材数据
   */
  async load() {
    if (this._data && this._dict) return this._data;

    if (this._loadPromise) return this._loadPromise;

    this._isLoading = true;
    this._loadPromise = (async () => {
      try {
        // 并行加载单元结构和词典
        const [unitsRes, dictRes] = await Promise.all([
          fetch('data/textbook-units.json'),
          fetch('data/textbook-dictionary.json')
        ]);

        if (!unitsRes.ok) throw new Error(`加载教材单元数据失败: HTTP ${unitsRes.status}`);
        this._data = await unitsRes.json();

        // 词典加载失败不阻断，降级使用gk3500匹配
        if (dictRes.ok) {
          this._dict = await dictRes.json();
          // 构建映射表
          this._dictMap = {};
          for (const entry of this._dict) {
            if (entry && entry.word) {
              this._dictMap[entry.word.toLowerCase().trim()] = entry;
            }
          }
          console.log(`[TextbookService] 教材词典加载完成，${this._dict.length} 个词条`);
        } else {
          console.warn('[TextbookService] 教材词典加载失败，将降级使用gk3500匹配');
        }

        console.log(`[TextbookService] 教材数据加载完成，共 ${this._data.books ? this._data.books.length : 0} 本书`);
        return this._data;
      } catch (error) {
        console.error('[TextbookService] 加载教材数据失败:', error);
        this._data = { books: [] };
        throw error;
      } finally {
        this._isLoading = false;
      }
    })();

    return this._loadPromise;
  }

  isLoaded() {
    return this._data !== null;
  }

  _findBook(book) {
    if (!this._data || !this._data.books) return null;
    return this._data.books.find((b) => b.book === book) || null;
  }

  getBooks() {
    if (!this._data || !this._data.books) return [];
    return this._data.books.map((b) => ({
      book: b.book,
      name: b.name,
      unitCount: b.units ? b.units.length : 0,
    }));
  }

  getUnits(book) {
    const bookData = this._findBook(book);
    if (!bookData || !bookData.units) return [];
    return bookData.units.map((u) => ({
      unit: u.unit,
      title: u.title,
      wordCount: u.words ? u.words.length : 0,
    }));
  }

  getUnitWords(book, unit) {
    const bookData = this._findBook(book);
    if (!bookData || !bookData.units) return [];
    const unitData = bookData.units.find((u) => u.unit === unit);
    if (!unitData || !unitData.words) return [];
    return unitData.words;
  }

  /**
   * 查找单词属于哪本书哪个单元
   */
  findWordLocation(word) {
    if (!this._data || !this._data.books) return null;
    if (!word || typeof word !== 'string') return null;

    const lowerWord = word.toLowerCase().trim();
    if (!lowerWord) return null;

    for (const b of this._data.books) {
      if (!b.units) continue;
      for (const u of b.units) {
        if (!u.words) continue;
        const found = u.words.some((w) => w.toLowerCase() === lowerWord);
        if (found) {
          return {
            book: b.book,
            bookName: b.name,
            unit: u.unit,
            title: u.title,
          };
        }
      }
    }
    return null;
  }

  /**
   * 获取教材单词的完整词条（音标、释义等）
   * 优先从教材词典查找，降级从gk3500查找
   * @param {string} word - 单词
   * @returns {object|null} 词条对象或 null
   */
  matchWordToDictionary(word) {
    if (!word || typeof word !== 'string') return null;
    const lower = word.toLowerCase().trim();

    // 1. 先从教材词典查找
    if (this._dictMap && this._dictMap[lower]) {
      return this._dictMap[lower];
    }

    // 2. 降级从gk3500查找
    if (window.wordService && wordService.isLoaded()) {
      if (!this._gkMap) {
        const dict = wordService._dictionary;
        if (!dict || !Array.isArray(dict)) return null;
        this._gkMap = {};
        for (const entry of dict) {
          if (entry && entry.word) {
            this._gkMap[entry.word.toLowerCase()] = entry;
          }
        }
      }
      return this._gkMap[lower] || null;
    }

    return null;
  }

  /**
   * 获取指定单元的所有单词词条列表（含音标、释义）
   * 跳过短语，只返回单个单词
   */
  getMatchedUnitWords(book, unit) {
    const words = this.getUnitWords(book, unit);
    const result = [];
    let fakeId = 9000000;

    for (const w of words) {
      // 跳过短语和特殊格式
      if (!w || w.includes(' ') || w.includes('...') || w.includes('/')) {
        continue;
      }

      const entry = this.matchWordToDictionary(w);
      if (entry) {
        // 统一格式
        result.push({
          id: entry.id || fakeId++,
          word: entry.word || w,
          phonetic: entry.phonetic || '',
          translation: entry.translation || '',
          pos: entry.pos || '',
          collins: entry.collins || 0,
          oxford: entry.oxford || 0,
          bnc: entry.bnc || 0,
          frq: entry.frq || 0,
        });
      } else {
        // 完全未找到的单词
        result.push({
          id: fakeId++,
          word: w,
          phonetic: '',
          translation: '',
          pos: '',
          collins: 0,
          oxford: 0,
          bnc: 0,
          frq: 0,
        });
      }
    }
    return result;
  }

  /**
   * 获取指定单元的所有单词（含短语），带词典数据
   * 用于单词表展示（不跳过短语）
   */
  getUnitWordsWithDict(book, unit) {
    const words = this.getUnitWords(book, unit);
    const result = [];

    for (const w of words) {
      const entry = this.matchWordToDictionary(w);
      result.push({
        word: w,
        phonetic: entry ? (entry.phonetic || '') : '',
        translation: entry ? (entry.translation || '') : '',
        pos: entry ? (entry.pos || '') : '',
        collins: entry ? (entry.collins || 0) : 0,
        oxford: entry ? (entry.oxford || 0) : 0,
        isPhrase: w.includes(' ') || w.includes('...') || w.includes('/'),
      });
    }
    return result;
  }

  getAllTextbookWords() {
    if (!this._data || !this._data.books) return [];
    const result = [];
    for (const b of this._data.books) {
      if (!b.units) continue;
      for (const u of b.units) {
        if (!u.words) continue;
        for (const w of u.words) {
          result.push({
            word: w,
            book: b.book,
            bookName: b.name,
            unit: u.unit,
            unitTitle: u.title,
          });
        }
      }
    }
    return result;
  }
}

window.TextbookService = TextbookService;
window.textbookService = new TextbookService();
