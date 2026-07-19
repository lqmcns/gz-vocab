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

  /**
   * 从 words 数组项中提取单词文本（兼容字符串和对象格式）
   * 新格式：{ code: "010101", word: "survey" }
   * 旧格式："survey"
   * @param {string|object} item - words 数组中的一项
   * @returns {string} 单词文本
   */
  _extractWord(item) {
    if (!item) return '';
    if (typeof item === 'string') return item;
    if (typeof item === 'object') return item.word || '';
    return '';
  }

  /**
   * 从 words 数组项中提取长编码（兼容字符串和对象格式）
   * @param {string|object} item - words 数组中的一项
   * @param {number} book - 书号（用于动态生成编码）
   * @param {number} unit - 单元号
   * @param {number} index - 索引
   * @returns {string} 长编码
   */
  _extractCode(item, book, unit, index) {
    if (item && typeof item === 'object' && item.code) return item.code;
    // 动态生成（兼容旧格式）
    return this.getWordCode(book, unit, index);
  }

  getUnitWords(book, unit) {
    const bookData = this._findBook(book);
    if (!bookData || !bookData.units) return [];
    const unitData = bookData.units.find((u) => u.unit === unit);
    if (!unitData || !unitData.words) return [];
    // 兼容新旧格式：统一返回字符串数组
    return unitData.words.map((w) => this._extractWord(w));
  }

  /**
   * 获取指定单元的单词列表（带长编码，原始格式）
   * @param {number} book - 书号
   * @param {number} unit - 单元号
   * @returns {Array<{code: string, word: string}>}
   */
  getUnitWordsWithCode(book, unit) {
    const bookData = this._findBook(book);
    if (!bookData || !bookData.units) return [];
    const unitData = bookData.units.find((u) => u.unit === unit);
    if (!unitData || !unitData.words) return [];
    return unitData.words.map((w, i) => ({
      code: this._extractCode(w, book, unit, i),
      word: this._extractWord(w),
    }));
  }

  /**
   * 生成教材单词的长编码（BBUUWW 格式）
   * 格式：2位书 + 2位单元 + 2位单词序号
   * 例如：010101 = 第1本书 第1单元 第1个单词(apple)
   * @param {number} book - 书号
   * @param {number} unit - 单元号
   * @param {number} index - 单词在单元中的索引（从0开始）
   * @returns {string} 6位长编码
   */
  getWordCode(book, unit, index) {
    const bb = String(book).padStart(2, '0');
    const uu = String(unit).padStart(2, '0');
    const ww = String(index + 1).padStart(2, '0');
    return `${bb}${uu}${ww}`;
  }

  /**
   * 根据长编码查找单词
   * @param {string} code - 6位长编码（BBUUWW）
   * @returns {object|null} { book, unit, index, word } 或 null
   */
  findWordByCode(code) {
    if (!code || code.length !== 6) return null;
    const book = parseInt(code.substring(0, 2), 10);
    const unit = parseInt(code.substring(2, 4), 10);
    const index = parseInt(code.substring(4, 6), 10) - 1;
    const words = this.getUnitWords(book, unit);
    if (index < 0 || index >= words.length) return null;
    return { book, unit, index, word: words[index] };
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
        const found = u.words.some((w) => this._extractWord(w).toLowerCase() === lowerWord);
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

    // 1. 先从 gk3500 查找（大小写更规范，释义更完整）
    if (window.wordService && wordService.isLoaded()) {
      if (!this._gkMap) {
        const dict = wordService._dictionary;
        if (dict && Array.isArray(dict)) {
          this._gkMap = {};
          for (const entry of dict) {
            if (entry && entry.word) {
              this._gkMap[entry.word.toLowerCase()] = entry;
            }
          }
        }
      }
      if (this._gkMap && this._gkMap[lower]) {
        return this._gkMap[lower];
      }
    }

    // 2. 降级从教材词典查找
    if (this._dictMap && this._dictMap[lower]) {
      const entry = this._dictMap[lower];
      // 专有名词大小写修正（教材词典里都是小写，但应该大写）
      const PROPER_NOUNS = new Set([
        'african','amsterdam','netherlands','jewish','christian','german',
        'italian','spanish','korean','korea','european','british','english',
        'american','china','chinese','japan','japanese','asia','asian',
        'africa','america','australia','canadian','canada','italy','greece',
        'greek','britain','london','paris','washington','germany','russia',
        'russian','india','indian','europe','christmas','bible','arab',
        'moslem','muslim','christianity','french','france','spaniard',
        'swiss','switzerland','belgian','belgium','danish','denmark',
        'finnish','finland','norwegian','norway','swedish','sweden',
        'polish','poland','portuguese','portugal','dutch','holland',
        'austrian','austria','irish','ireland','scottish','scotland',
        'welsh','wales','egyptian','egypt','brazilian','brazil',
        'mexican','mexico','argentinian','argentina','chilean','chile',
        'vietnamese','vietnam','thai','thailand','malaysian','malaysia',
        'indonesian','indonesia','filipino','philippines','pakistani',
        'pakistan','bangladeshi','bangladesh','turkish','turkey',
        'israeli','israel','lebanese','lebanon','jordanian','jordan',
        'syrian','syria','iraqi','iraq','iranian','iran','afghan',
        'afghanistan','cambridge','oxford','harvard','yale','mit',
        'shakespeare','shakespearean','elizabeth','victoria','david',
        'michael','james','charles','william','thomas','richard',
        'robert','daniel','matthew','christopher','joseph','andrew',
        'joshua','kenneth','kevin','steven','brian','george','edward',
        'ronald','timothy','jason','jeffrey','ryan','jacob','gary',
      ]);
      if (PROPER_NOUNS.has(lower)) {
        // 返回修正大小写后的副本（首字母大写）
        return { ...entry, word: lower.charAt(0).toUpperCase() + lower.slice(1) };
      }
      return entry;
    }

    return null;
  }

  /**
   * 获取指定单元的所有单词词条列表（含音标、释义）
   * 不跳过短语，短语也参与学习
   */
  getMatchedUnitWords(book, unit) {
    // 使用 getUnitWordsWithCode 获取带长编码的单词列表
    const wordsWithCode = this.getUnitWordsWithCode(book, unit);
    const result = [];
    // fakeId 编码 book 和 unit，确保全局唯一：9000000 + book*1000 + unit*10 + index
    let fakeIdBase = 9000000 + book * 1000 + unit * 10;

    for (let i = 0; i < wordsWithCode.length; i++) {
      const item = wordsWithCode[i];
      const w = item.word;
      if (!w) continue;

      const entry = this.matchWordToDictionary(w);
      // 优先使用 JSON 文件中的长编码
      const wordCode = item.code || this.getWordCode(book, unit, i);
      if (entry) {
        // 统一格式
        result.push({
          id: entry.id || (fakeIdBase + i),
          code: wordCode,
          word: entry.word || w,
          phonetic: entry.phonetic || '',
          translation: entry.translation || '',
          pos: entry.pos || '',
          collins: entry.collins || 0,
          oxford: entry.oxford || 0,
          bnc: entry.bnc || 0,
          frq: entry.frq || 0,
          isPhrase: w.includes(' ') || w.includes('...') || w.includes('/'),
        });
      } else {
        // 完全未找到的单词（包括短语）
        result.push({
          id: fakeIdBase + i,
          code: wordCode,
          word: w,
          phonetic: '',
          translation: '',
          pos: '',
          collins: 0,
          oxford: 0,
          bnc: 0,
          frq: 0,
          isPhrase: w.includes(' ') || w.includes('...') || w.includes('/'),
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
    // 使用 getUnitWordsWithCode 获取带长编码的单词列表
    const wordsWithCode = this.getUnitWordsWithCode(book, unit);
    const result = [];

    for (let i = 0; i < wordsWithCode.length; i++) {
      const item = wordsWithCode[i];
      const w = item.word;
      const entry = this.matchWordToDictionary(w);
      result.push({
        word: w,
        code: item.code || this.getWordCode(book, unit, i),
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
        for (let i = 0; i < u.words.length; i++) {
          const w = u.words[i];
          result.push({
            word: this._extractWord(w),
            code: this._extractCode(w, b.book, u.unit, i),
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
