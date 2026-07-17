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
    const words = this.getUnitWords(book, unit);
    const result = [];
    // fakeId 编码 book 和 unit，确保全局唯一：9000000 + book*1000 + unit*10 + index
    let fakeIdBase = 9000000 + book * 1000 + unit * 10;

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (!w) continue;

      const entry = this.matchWordToDictionary(w);
      if (entry) {
        // 统一格式
        result.push({
          id: entry.id || (fakeIdBase + i),
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
