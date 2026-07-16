/**
 * spell-module.js - 拼写训练核心模块（重写版）
 * 支持三种训练模式：
 *   1. partial  - 部分挖空选词模式（核心）：展示带空格的单词，用户选出空缺的元音组合
 *   2. full     - 完整音节选词模式：每个音节都需选择
 *   3. manual   - 手动拼写模式：用户直接输入整个单词
 *
 * 依赖：SyllableService（音节拆分）、SimilarSoundsService（干扰项生成）、
 *       ProgressStorage（进度存储）
 */

const SpellModule = {
  /* ===========================
     配置常量
     =========================== */

  /**
   * 元音字母组合列表（按长度降序排列，优先匹配长组合）
   * 用于部分挖空模式中寻找挖空目标
   * @private
   */
  VOWEL_COMBOS: [
    // 4字母组合
    'tion', 'sion', 'ture', 'ough', 'augh', 'eigh', 'ious', 'eous',
    // 3字母组合
    'igh', 'ear', 'air', 'oar', 'our', 'ier', 'eer', 'oor', 'uar', 'uar',
    'ies', 'ies', 'yed', 'ous',
    // 2字母组合
    'ea', 'ou', 'ie', 'ei', 'oo', 'ai', 'ay', 'ee', 'oa', 'ui',
    'au', 'aw', 'ew', 'ow', 'oy', 'eu', 'oi',
    'ar', 'er', 'ir', 'or', 'ur',
  ],

  /**
   * 单个元音字母（最后兜底用）
   * @private
   */
  SINGLE_VOWELS: ['a', 'e', 'i', 'o', 'u'],

  /* ===========================
     内部状态
     =========================== */

  /**
   * 当前训练模式：'partial' | 'full' | 'manual'
   */
  mode: 'partial',

  /**
   * 当前训练批次的单词列表
   * @private
   */
  _words: [],

  /**
   * 当前批次中的单词索引
   * @private
   */
  _wordIndex: 0,

  /**
   * 当前单词对象
   */
  currentWord: null,

  /**
   * 当前单词的实际使用模式（可能与 this.mode 不同，当降级时）
   * @private
   */
  _actualMode: 'partial',

  /**
   * 挖空信息数组
   * 每项：{ start, end, answer, options, userAnswer }
   * @private
   */
  _blanks: [],

  /**
   * 当前正在填的空缺索引
   * @private
   */
  _blankIndex: 0,

  /**
   * 完整音节模式的音节数组
   * @private
   */
  _syllables: [],

  /**
   * 用户已选音节（完整音节模式）
   * @private
   */
  _userSelections: [],

  /**
   * 当前选项列表
   * @private
   */
  _currentOptions: [],

  /**
   * 当前单词的错误尝试次数
   * @private
   */
  _attempts: 0,

  /**
   * 每个空缺/单词的最大尝试次数
   * @private
   */
  _maxAttempts: 3,

  /**
   * 选项加载中标志
   * @private
   */
  _loadingOptions: false,

  /**
   * 训练统计
   * @private
   */
  _stats: {
    total: 0,
    correct: 0,
    wrong: 0,
    skipped: 0,
  },

  /**
   * 学习模式标志（在学习流程中调用时为 true）
   * 学习模式下不自动保存进度，由学习流程统一处理
   * @private
   */
  _learnMode: false,

  /**
   * 学习模式完成回调
   * @private
   */
  _onCompleteCallback: null,

  /**
   * 本轮拼写中出错的单词列表（用于学习模式重试）
   * @private
   */
  _wrongWords: [],

  /**
   * 渲染目标 section ID（默认 'spell'，学习模式中可为 'learn'）
   * @private
   */
  _targetSection: 'spell',

  /* ===========================
     公开方法
     =========================== */

  /**
   * 开始拼写训练
   * @param {object[]} words - 单词对象数组，每个对象需包含 word 属性
   * @param {string} mode - 训练模式：'partial' | 'full' | 'manual'
   * @param {object} [options] - 可选配置
   * @param {boolean} [options.learnMode] - 是否在学习流程中调用
   * @param {function} [options.onComplete] - 学习模式完成回调，接收 {stats, wrongWords} 参数
   * @param {string} [options.targetSection] - 渲染目标 section ID
   * @param {string} [options.title] - 训练标题（学习模式中显示）
   */
  start(words, mode = 'partial', options = {}) {
    if (!Array.isArray(words) || words.length === 0) {
      console.warn('[SpellModule] 无效的单词列表');
      showToast('没有可训练的单词', 'error');
      return;
    }

    this._words = words;
    this._wordIndex = 0;
    this.mode = mode;
    this._stats = { total: 0, correct: 0, wrong: 0, skipped: 0 };
    this._wrongWords = [];
    this._learnMode = options.learnMode || false;
    this._onCompleteCallback = options.onComplete || null;
    this._targetSection = options.targetSection || 'spell';
    this._title = options.title || '';

    const section = document.getElementById(this._targetSection);
    if (section) {
      section.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon" style="animation: spin 1s linear infinite;">&#x2699;&#xFE0F;</div>
          <div class="empty-text">正在准备拼写训练...</div>
        </div>
      `;
    }

    this._loadCurrentWord();
  },

  /**
   * 渲染当前单词的训练界面（根据模式分发）
   */
  async renderCurrentWord() {
    if (!this.currentWord) return;

    // 根据实际模式分发渲染
    switch (this._actualMode) {
      case 'partial':
        await this._renderPartialMode();
        break;
      case 'full':
        await this._renderFullMode();
        break;
      case 'manual':
        this._renderManualMode();
        break;
    }
  },

  /**
   * 进入下一个单词
   */
  nextWord() {
    this._wordIndex++;

    if (this._wordIndex >= this._words.length) {
      this.complete();
      return;
    }

    this._loadCurrentWord();
  },

  /**
   * 训练完成，显示统计结果
   */
  complete() {
    const section = document.getElementById(this._targetSection);
    if (!section) return;

    this.currentWord = null; // 清除当前单词，允许重新选择

    const { total, correct, wrong, skipped } = this._stats;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

    // 学习模式：调用回调，由学习流程处理后续逻辑
    if (this._learnMode && this._onCompleteCallback) {
      this._onCompleteCallback({
        stats: { total, correct, wrong, skipped, accuracy },
        wrongWords: this._wrongWords,
      });
      return;
    }

    const modeNames = {
      partial: '部分挖空选词',
      full: '完整音节选词',
      manual: '手动拼写',
    };

    section.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">&#x1F3C6;</div>
        <div class="empty-text">拼写训练完成</div>
        <div class="empty-sub">模式：${modeNames[this.mode] || this.mode}</div>

        <div class="card mt-2" style="max-width: 320px; margin-left: auto; margin-right: auto;">
          <div class="card-header">训练统计</div>
          <div style="text-align: left; padding: 0.5rem 0;">
            <div style="display: flex; justify-content: space-between; padding: 0.3rem 0; border-bottom: 1px solid var(--border);">
              <span>训练单词数</span>
              <strong>${total}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 0.3rem 0; border-bottom: 1px solid var(--border); color: var(--accent);">
              <span>正确</span>
              <strong>${correct}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 0.3rem 0; border-bottom: 1px solid var(--border); color: var(--danger);">
              <span>错误</span>
              <strong>${wrong}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 0.3rem 0; border-bottom: 1px solid var(--border); color: var(--warning);">
              <span>跳过</span>
              <strong>${skipped}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 0.3rem 0;">
              <span>正确率</span>
              <strong>${accuracy}%</strong>
            </div>
          </div>
          <div class="progress-labeled mt-1">
            <div class="progress-bar">
              <div class="progress-bar-fill" style="width: ${accuracy}%;"></div>
            </div>
            <span class="progress-text">${accuracy}%</span>
          </div>
        </div>

        <div class="flex gap-1 mt-2" style="justify-content: center;">
          <button class="btn btn-primary" onclick="SpellModule.restart()">再来一次</button>
          <button class="btn btn-ghost" onclick="navigate('spell')">返回设置</button>
          <button class="btn btn-ghost" onclick="navigate('home')">返回首页</button>
        </div>
      </div>
    `;

    showToast(`拼写训练完成！正确率 ${accuracy}%`, accuracy >= 80 ? 'success' : 'info');
  },

  /**
   * 处理用户点击选项（部分挖空模式 & 完整音节模式共用）
   * @param {number} optionIndex - 用户点击的选项索引
   */
  handleOptionClick(optionIndex) {
    if (this._loadingOptions) return;
    if (!this._currentOptions || this._currentOptions.length === 0) return;

    const selectedOption = this._currentOptions[optionIndex];
    if (!selectedOption) return;

    // 根据模式获取正确答案
    let correctAnswer = '';
    if (this._actualMode === 'partial') {
      if (this._blankIndex >= this._blanks.length) return;
      correctAnswer = this._blanks[this._blankIndex].answer;
    } else if (this._actualMode === 'full') {
      if (this._blankIndex >= this._syllables.length) return;
      correctAnswer = this._syllables[this._blankIndex];
    }

    const optionsContainer = document.getElementById('spell-options');
    const feedbackContainer = document.getElementById('spell-feedback');
    if (!optionsContainer || !feedbackContainer) return;

    const buttons = optionsContainer.querySelectorAll('.spell-option-btn');
    const clickedBtn = buttons[optionIndex];
    if (!clickedBtn) return;

    // 禁用所有按钮
    buttons.forEach((btn) => {
      btn.disabled = true;
    });

    if (selectedOption.toLowerCase() === correctAnswer.toLowerCase()) {
      // ========== 选择正确 ==========
      clickedBtn.classList.add('correct');

      if (this._actualMode === 'partial') {
        // 记录用户答案
        this._blanks[this._blankIndex].userAnswer = correctAnswer;
        this._blankIndex++;
      } else if (this._actualMode === 'full') {
        this._userSelections.push(correctAnswer);
        this._blankIndex++;
      }

      this._attempts = 0;
      feedbackContainer.innerHTML = '<span style="color: var(--accent); font-size: 0.9rem;">&#x2705; 正确！</span>';

      // 延迟后进入下一个空缺或完成当前单词
      setTimeout(async () => {
        const totalBlanks = this._actualMode === 'partial'
          ? this._blanks.length
          : this._syllables.length;

        if (this._blankIndex >= totalBlanks) {
          // 所有空缺都已填完
          this._onWordComplete(true);
        } else {
          // 进入下一个空缺，加载新选项
          this._loadingOptions = true;
          await this.renderCurrentWord();
        }
      }, 500);
    } else {
      // ========== 选择错误 ==========
      clickedBtn.classList.add('wrong');
      clickedBtn.style.animation = 'shake 0.4s ease-in-out';

      this._attempts++;
      feedbackContainer.innerHTML = `<span style="color: var(--danger); font-size: 0.9rem;">&#x2716; 不对，再选一次（剩余 ${this._maxAttempts - this._attempts} 次机会）</span>`;

      if (this._attempts >= this._maxAttempts) {
        // 超过最大尝试次数
        setTimeout(() => {
          this._onWordFailed();
        }, 800);
      } else {
        // 启用按钮让用户重新选择（错误的按钮保持禁用）
        setTimeout(() => {
          buttons.forEach((btn, i) => {
            if (i === optionIndex) return; // 错误的按钮保持禁用
            btn.disabled = false;
            btn.style.animation = '';
          });
        }, 600);
      }
    }
  },

  /**
   * 检查手动拼写模式的输入
   */
  checkManualInput() {
    const input = document.getElementById('spell-manual-input');
    if (!input) return;

    const userInput = input.value.trim();
    if (!userInput) {
      showToast('请输入单词', 'error');
      return;
    }

    const correctWord = this.currentWord.word.toLowerCase();
    const isCorrect = userInput.toLowerCase() === correctWord;

    const feedbackContainer = document.getElementById('spell-feedback');
    if (!feedbackContainer) return;

    if (isCorrect) {
      this._onWordComplete(true);
    } else {
      this._attempts++;
      feedbackContainer.innerHTML = `
        <div style="color: var(--danger); font-size: 0.9rem;">
          &#x2716; 拼写不正确（剩余 ${this._maxAttempts - this._attempts} 次机会）
        </div>
      `;

      if (this._attempts >= this._maxAttempts) {
        this._onWordFailed();
      } else {
        // 清空输入框让用户重试
        input.value = '';
        input.focus();
      }
    }
  },

  /**
   * 跳过当前单词
   * 学习模式下跳过的单词会进入重试队列
   */
  skipWord() {
    this._onWordFailed();
  },

  /**
   * 重新开始训练（使用同一批单词和模式）
   */
  restart() {
    if (this._words.length > 0) {
      this.start(this._words, this.mode);
    } else {
      navigate('spell');
    }
  },

  /* ===========================
     内部方法 - 单词加载与模式分发
     =========================== */

  /**
   * 加载当前单词并初始化
   * @private
   */
  async _loadCurrentWord() {
    if (this._wordIndex >= this._words.length) {
      this.complete();
      return;
    }

    this.currentWord = this._words[this._wordIndex];
    this._blankIndex = 0;
    this._attempts = 0;
    this._userSelections = [];
    this._currentOptions = [];
    this._blanks = [];

    // 根据模式准备
    this._actualMode = this.mode;

    if (this.mode === 'partial') {
      // 部分挖空模式：尝试准备空缺
      this._blanks = await this._prepareBlanks(this.currentWord.word);
      if (!this._blanks || this._blanks.length === 0) {
        // 没有好的挖空点，降级为手动拼写
        console.log('[SpellModule] 单词无法挖空，降级为手动拼写:', this.currentWord.word);
        this._actualMode = 'manual';
      }
    } else if (this.mode === 'full') {
      // 完整音节模式：拆分音节
      if (window.syllableService) {
        this._syllables = syllableService.split(this.currentWord.word);
      } else {
        this._syllables = [this.currentWord.word];
      }
      // 太短的单词降级
      if (this._syllables.length < 2) {
        console.log('[SpellModule] 单词音节太少，降级为部分挖空:', this.currentWord.word);
        this._actualMode = 'partial';
        this._blanks = await this._prepareBlanks(this.currentWord.word);
        if (!this._blanks || this._blanks.length === 0) {
          this._actualMode = 'manual';
        }
      }
    }
    // manual 模式无需额外准备

    // 标记需要加载选项
    if (this._actualMode === 'partial' || this._actualMode === 'full') {
      this._loadingOptions = true;
    }

    await this.renderCurrentWord();
  },

  /* ===========================
     内部方法 - 部分挖空模式
     =========================== */

  /**
   * 为单词准备挖空信息
   * 1. 查找元音字母组合作为挖空目标
   * 2. 选择 1-2 个挖空点
   * 3. 为每个挖空点生成选项
   *
   * @private
   * @param {string} word - 单词
   * @returns {Promise<Array|null>} 挖空信息数组或 null（无法挖空）
   */
  async _prepareBlanks(word) {
    const lower = word.toLowerCase().trim();
    if (!lower || lower.length < 4) return null; // 太短的单词不挖空

    // 查找所有元音组合候选
    const candidates = this._findVowelCombos(lower);

    // 如果没有找到 2 字母以上的组合，尝试单字母元音
    if (candidates.length === 0) {
      candidates.push(...this._findSingleVowels(lower));
    }

    if (candidates.length === 0) return null;

    // 选择 1-2 个挖空点（按长度降序排列，优先选择长组合）
    candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start));
    const maxBlanks = lower.length > 8 ? 2 : 1;
    const selected = candidates.slice(0, maxBlanks);

    // 按位置排序
    selected.sort((a, b) => a.start - b.start);

    // 为每个挖空点生成选项
    const blanks = [];
    for (const sel of selected) {
      const answer = lower.substring(sel.start, sel.end);
      const options = await this._generateBlankOptions(answer);
      blanks.push({
        start: sel.start,
        end: sel.end,
        answer: answer,
        options: options,
        userAnswer: null,
      });
    }

    return blanks.length > 0 ? blanks : null;
  },

  /**
   * 在单词中查找元音字母组合
   * @private
   * @param {string} word - 小写单词
   * @returns {Array<{start: number, end: number}>} 匹配结果
   */
  _findVowelCombos(word) {
    const results = [];
    const used = new Array(word.length).fill(false); // 标记已占用的位置

    for (const combo of this.VOWEL_COMBOS) {
      let idx = word.indexOf(combo);
      while (idx !== -1) {
        const end = idx + combo.length;
        // 检查是否与已选中的组合重叠
        let overlaps = false;
        for (let i = idx; i < end; i++) {
          if (used[i]) {
            overlaps = true;
            break;
          }
        }
        if (!overlaps) {
          results.push({ start: idx, end: end });
          // 标记占用
          for (let i = idx; i < end; i++) {
            used[i] = true;
          }
        }
        idx = word.indexOf(combo, idx + 1);
      }
    }

    return results;
  },

  /**
   * 在单词中查找单个元音字母（兜底用）
   * @private
   * @param {string} word - 小写单词
   * @returns {Array<{start: number, end: number}>} 匹配结果
   */
  _findSingleVowels(word) {
    const results = [];
    for (let i = 0; i < word.length; i++) {
      if (this.SINGLE_VOWELS.includes(word[i])) {
        results.push({ start: i, end: i + 1 });
      }
    }
    return results;
  },

  /**
   * 为挖空答案生成选项（正确答案 + 干扰项）
   * @private
   * @param {string} answer - 正确答案（如 "ea"）
   * @returns {Promise<string[]>} 选项数组（含正确答案，已打乱）
   */
  async _generateBlankOptions(answer) {
    const distractorCount = 3; // 加上正确答案共 4 个选项
    let distractors = [];

    // 尝试使用 SimilarSoundsService 生成干扰项
    try {
      if (window.similarSounds) {
        distractors = await similarSounds.generateDistractors(answer, distractorCount);
      }
    } catch (e) {
      console.warn('[SpellModule] 获取干扰项失败:', e);
    }

    // 过滤掉与正确答案相同的干扰项
    distractors = distractors.filter(
      (d) => d.toLowerCase() !== answer.toLowerCase()
    );

    // 如果干扰项不足，用规则补充
    if (distractors.length < distractorCount) {
      const ruleBased = this._generateRuleBasedOptions(answer, distractorCount);
      for (const d of ruleBased) {
        if (
          distractors.length >= distractorCount
          || distractors.includes(d)
          || d.toLowerCase() === answer.toLowerCase()
        ) {
          continue;
        }
        distractors.push(d);
      }
    }

    // 取所需数量
    distractors = distractors.slice(0, distractorCount);

    // 组合并打乱
    return shuffleArray([answer, ...distractors]);
  },

  /**
   * 规则化生成干扰项（兜底用）
   * 通过元音替换和常见组合生成相似变体
   * @private
   * @param {string} answer - 正确答案
   * @param {number} count - 需要的数量
   * @returns {string[]} 干扰项数组
   */
  _generateRuleBasedOptions(answer, count) {
    const lower = answer.toLowerCase();
    const distractors = new Set();
    const vowels = 'aeiou';

    // 常见元音组合池（用于替换）
    const comboPool = [
      'ea', 'ee', 'ie', 'ei', 'oo', 'ou', 'oa', 'ai', 'ay', 'aw',
      'au', 'ew', 'ow', 'oy', 'oi', 'ar', 'er', 'ir', 'or', 'ur',
      'igh', 'tion', 'sion', 'ture',
    ];

    // 策略1：用其他元音组合替换
    for (const combo of comboPool) {
      if (combo.toLowerCase() !== lower) {
        // 长度相近的优先
        if (Math.abs(combo.length - lower.length) <= 1) {
          distractors.add(combo);
        }
      }
      if (distractors.size >= count * 3) break;
    }

    // 策略2：替换答案中的元音
    const chars = lower.split('');
    for (let i = 0; i < chars.length; i++) {
      if (vowels.includes(chars[i])) {
        for (const v of vowels) {
          if (v !== chars[i]) {
            const variant = [...chars];
            variant[i] = v;
            distractors.add(variant.join(''));
          }
        }
      }
      if (distractors.size >= count * 3) break;
    }

    // 策略3：单字母变体（取答案的第一个字母或缩短）
    if (lower.length > 1) {
      distractors.add(lower[0]); // 取首字母
      distractors.add(lower.substring(0, lower.length - 1)); // 去尾
    }

    return shuffleArray([...distractors]).slice(0, count);
  },

  /**
   * 渲染部分挖空模式界面
   * @private
   */
  async _renderPartialMode() {
    const section = document.getElementById(this._targetSection);
    if (!section || !this.currentWord) return;

    const progressPercent = Math.round(
      (this._wordIndex / this._words.length) * 100
    );

    section.innerHTML = `
      <!-- 批次进度 -->
      <div class="step-indicator">
        <span class="step-text">
          第 <strong>${this._wordIndex + 1}</strong> / ${this._words.length} 个单词
          &nbsp;|&nbsp;
          空缺 <strong>${this._blankIndex}</strong> / ${this._blanks.length}
        </span>
        <span class="progress-bar" style="width: 120px;">
          <div class="progress-bar-fill" style="width: ${progressPercent}%"></div>
        </span>
      </div>

      <!-- 单词信息 -->
      <div class="word-card">
        <div class="word-text" style="font-size: 1.1rem; opacity: 0.6;">
          ${this.currentWord.translation || ''}
        </div>
        ${this.currentWord.phonetic ? `
        <div class="word-phonetic">${this.currentWord.phonetic}</div>
        ` : ''}

        <!-- 带空缺的单词展示区 -->
        <div id="spell-preview" style="text-align: center; margin: 1.5rem 0; min-height: 60px;">
          ${this._renderWordWithBlanks()}
        </div>

        <!-- 剩余机会提示 -->
        <div style="text-align: center; margin-bottom: 0.5rem;">
          <span class="text-muted" style="font-size: 0.85rem;">
            剩余机会: ${this._maxAttempts - this._attempts}
          </span>
        </div>

        <!-- 选项按钮区 -->
        <div id="spell-options" class="spell-options">
          ${this._loadingOptions
            ? '<span class="text-muted">加载选项中...</span>'
            : this._renderOptionButtons()}
        </div>

        <!-- 结果提示区 -->
        <div id="spell-feedback" style="text-align: center; min-height: 2rem; margin-top: 0.5rem;"></div>

        <!-- 操作按钮 -->
        <div class="word-actions" style="margin-top: 0.5rem;">
          <button class="btn btn-ghost btn-sm" onclick="speakWord('${this.currentWord.word}')">
            &#x1F50A; 听发音
          </button>
          <button class="btn btn-ghost btn-sm" onclick="SpellModule.skipWord()">
            跳过
          </button>
        </div>
      </div>
    `;

    // 如果正在加载选项，触发加载
    if (this._loadingOptions) {
      await this._loadOptionsForCurrent();
    }

    // 自动播放发音
    if (this._blankIndex === 0) {
      speakWord(this.currentWord.word);
    }
  },

  /**
   * 渲染带空缺的单词
   * 将空缺部分用下划线表示，已填部分显示用户答案
   * @private
   * @returns {string} HTML 字符串
   */
  _renderWordWithBlanks() {
    const word = this.currentWord.word.toLowerCase();
    const segments = this._buildDisplaySegments(word, this._blanks);

    return segments.map((seg) => {
      if (seg.type === 'text') {
        return `<span style="font-size: 2rem; font-weight: 700; color: var(--text-primary); letter-spacing: 1px;">${seg.text}</span>`;
      } else {
        const blank = seg.blank;
        const isCurrent = seg.blankIndex === this._blankIndex;
        const isAnswered = blank.userAnswer !== null;

        if (isAnswered) {
          // 已回答的空缺：显示答案
          return `<span class="word-blank blank-filled" style="
            display: inline-block; min-width: 40px; padding: 2px 8px; margin: 0 2px;
            font-size: 2rem; font-weight: 700; color: var(--accent);
            border-bottom: 3px solid var(--accent);
          ">${blank.userAnswer}</span>`;
        } else if (isCurrent) {
          // 当前空缺：高亮下划线
          const underline = '_'.repeat(Math.max(blank.answer.length, 2));
          return `<span class="word-blank blank-current" style="
            display: inline-block; min-width: 40px; padding: 2px 8px; margin: 0 2px;
            font-size: 2rem; font-weight: 700; color: var(--accent);
            border-bottom: 3px solid var(--accent);
            background: var(--accent-light);
            border-radius: 4px 4px 0 0;
            animation: pulse 1.2s ease-in-out infinite;
          ">${underline}</span>`;
        } else {
          // 未选的空缺：灰色下划线
          const underline = '_'.repeat(Math.max(blank.answer.length, 2));
          return `<span class="word-blank blank-empty" style="
            display: inline-block; min-width: 40px; padding: 2px 8px; margin: 0 2px;
            font-size: 2rem; font-weight: 700; color: var(--text-muted);
            border-bottom: 3px solid var(--border);
          ">${underline}</span>`;
        }
      }
    }).join('');
  },

  /**
   * 构建单词的显示分段（文本段 + 空缺段）
   * @private
   * @param {string} word - 完整单词
   * @param {Array} blanks - 空缺数组
   * @returns {Array} 分段数组
   */
  _buildDisplaySegments(word, blanks) {
    const segments = [];
    let pos = 0;

    for (let i = 0; i < blanks.length; i++) {
      const blank = blanks[i];
      // 空缺前的文本
      if (blank.start > pos) {
        segments.push({ type: 'text', text: word.substring(pos, blank.start) });
      }
      // 空缺本身
      segments.push({ type: 'blank', blankIndex: i, blank: blank });
      pos = blank.end;
    }

    // 末尾剩余文本
    if (pos < word.length) {
      segments.push({ type: 'text', text: word.substring(pos) });
    }

    return segments;
  },

  /* ===========================
     内部方法 - 完整音节模式
     =========================== */

  /**
   * 渲染完整音节选词模式界面
   * @private
   */
  async _renderFullMode() {
    const section = document.getElementById(this._targetSection);
    if (!section || !this.currentWord) return;

    const totalSyllables = this._syllables.length;
    const progressPercent = Math.round(
      (this._wordIndex / this._words.length) * 100
    );

    section.innerHTML = `
      <!-- 批次进度 -->
      <div class="step-indicator">
        <span class="step-text">
          第 <strong>${this._wordIndex + 1}</strong> / ${this._words.length} 个单词
          &nbsp;|&nbsp;
          音节 <strong>${this._blankIndex}</strong> / ${totalSyllables}
        </span>
        <span class="progress-bar" style="width: 120px;">
          <div class="progress-bar-fill" style="width: ${progressPercent}%"></div>
        </span>
      </div>

      <!-- 单词信息 -->
      <div class="word-card">
        <div class="word-text" style="font-size: 1.1rem; opacity: 0.6;">
          ${this.currentWord.translation || ''}
        </div>
        ${this.currentWord.phonetic ? `
        <div class="word-phonetic">${this.currentWord.phonetic}</div>
        ` : ''}

        <!-- 音节预览区 -->
        <div id="spell-preview" class="spell-slots">
          ${this._renderSyllableSlots()}
        </div>

        <!-- 剩余机会提示 -->
        <div style="text-align: center; margin-bottom: 0.5rem;">
          <span class="text-muted" style="font-size: 0.85rem;">
            剩余机会: ${this._maxAttempts - this._attempts}
          </span>
        </div>

        <!-- 选项按钮区 -->
        <div id="spell-options" class="spell-options">
          ${this._loadingOptions
            ? '<span class="text-muted">加载选项中...</span>'
            : this._renderOptionButtons()}
        </div>

        <!-- 结果提示区 -->
        <div id="spell-feedback" style="text-align: center; min-height: 2rem; margin-top: 0.5rem;"></div>

        <!-- 操作按钮 -->
        <div class="word-actions" style="margin-top: 0.5rem;">
          <button class="btn btn-ghost btn-sm" onclick="speakWord('${this.currentWord.word}')">
            &#x1F50A; 听发音
          </button>
          <button class="btn btn-ghost btn-sm" onclick="SpellModule.skipWord()">
            跳过
          </button>
        </div>
      </div>
    `;

    if (this._loadingOptions) {
      await this._loadOptionsForCurrent();
    }

    if (this._blankIndex === 0) {
      speakWord(this.currentWord.word);
    }
  },

  /**
   * 渲染音节格子
   * 已选音节显示内容，当前音节高亮，未选音节灰色
   * @private
   * @returns {string} HTML 字符串
   */
  _renderSyllableSlots() {
    let html = '';
    for (let i = 0; i < this._syllables.length; i++) {
      if (i < this._userSelections.length) {
        // 已选音节
        html += `
          <div class="spell-slot filled">${this._userSelections[i]}</div>
        `;
      } else if (i === this._userSelections.length) {
        // 当前音节
        html += `<div class="spell-slot current">?</div>`;
      } else {
        // 未选音节
        html += `<div class="spell-slot empty">_</div>`;
      }
    }
    return html;
  },

  /* ===========================
     内部方法 - 手动拼写模式
     =========================== */

  /**
   * 渲染手动拼写模式界面
   * @private
   */
  _renderManualMode() {
    const section = document.getElementById(this._targetSection);
    if (!section || !this.currentWord) return;

    const progressPercent = Math.round(
      (this._wordIndex / this._words.length) * 100
    );

    section.innerHTML = `
      <!-- 批次进度 -->
      <div class="step-indicator">
        <span class="step-text">
          第 <strong>${this._wordIndex + 1}</strong> / ${this._words.length} 个单词
        </span>
        <span class="progress-bar" style="width: 120px;">
          <div class="progress-bar-fill" style="width: ${progressPercent}%"></div>
        </span>
      </div>

      <!-- 单词信息 -->
      <div class="word-card">
        ${this.currentWord.phonetic ? `
        <div class="word-phonetic" style="font-size: 1.2rem; text-align: center;">${this.currentWord.phonetic}</div>
        ` : ''}

        <div class="word-translation" style="font-size: 1.3rem; text-align: center; margin: 1rem 0;">
          ${this.currentWord.translation || ''}
        </div>

        ${this.currentWord.pos ? `
        <div style="text-align: center; margin-bottom: 1rem;">
          <span class="word-pos">${formatPos(this.currentWord.pos)}</span>
        </div>
        ` : ''}

        <!-- 输入区 -->
        <div style="margin: 1.5rem 0;">
          <input
            type="text"
            id="spell-manual-input"
            class="form-control"
            placeholder="请输入完整的单词拼写..."
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            style="
              width: 100%; padding: 0.8rem 1rem; font-size: 1.3rem;
              text-align: center; letter-spacing: 2px;
              border: 2px solid var(--border); border-radius: var(--radius-sm);
              background: var(--bg-primary); color: var(--text-primary);
            "
            onkeydown="if(event.key==='Enter') SpellModule.checkManualInput()"
          />
        </div>

        <!-- 剩余机会提示 -->
        <div style="text-align: center; margin-bottom: 0.5rem;">
          <span class="text-muted" style="font-size: 0.85rem;">
            剩余机会: ${this._maxAttempts - this._attempts}
          </span>
        </div>

        <!-- 结果提示区 -->
        <div id="spell-feedback" style="text-align: center; min-height: 2rem; margin-top: 0.5rem;"></div>

        <!-- 操作按钮 -->
        <div class="word-actions" style="margin-top: 0.5rem; justify-content: center;">
          <button class="btn btn-primary" onclick="SpellModule.checkManualInput()">
            &#x2714; 检查
          </button>
          <button class="btn btn-ghost btn-sm" onclick="speakWord('${this.currentWord.word}')">
            &#x1F50A; 听发音
          </button>
          <button class="btn btn-ghost btn-sm" onclick="SpellModule.skipWord()">
            跳过
          </button>
        </div>
      </div>
    `;

    // 自动聚焦输入框
    setTimeout(() => {
      const input = document.getElementById('spell-manual-input');
      if (input) input.focus();
    }, 100);

    // 自动播放发音
    if (this._blankIndex === 0) {
      speakWord(this.currentWord.word);
    }
  },

  /* ===========================
     内部方法 - 选项加载与渲染
     =========================== */

  /**
   * 加载当前空缺/音节的选项
   * @private
   */
  async _loadOptionsForCurrent() {
    let correctAnswer = '';

    if (this._actualMode === 'partial') {
      if (this._blankIndex >= this._blanks.length) return;
      correctAnswer = this._blanks[this._blankIndex].answer;
      // 如果已有预生成的选项，直接使用
      if (this._blanks[this._blankIndex].options && this._blanks[this._blankIndex].options.length > 0) {
        this._currentOptions = this._blanks[this._blankIndex].options;
        this._loadingOptions = false;
        this._updateOptionsUI();
        return;
      }
    } else if (this._actualMode === 'full') {
      if (this._blankIndex >= this._syllables.length) return;
      correctAnswer = this._syllables[this._blankIndex];
    }

    // 生成选项
    this._currentOptions = await this._generateBlankOptions(correctAnswer);
    this._loadingOptions = false;
    this._updateOptionsUI();
  },

  /**
   * 更新选项区域 UI
   * @private
   */
  _updateOptionsUI() {
    const optionsContainer = document.getElementById('spell-options');
    if (optionsContainer) {
      optionsContainer.innerHTML = this._renderOptionButtons();
    }
  },

  /**
   * 渲染选项按钮
   * @private
   * @returns {string} HTML 字符串
   */
  _renderOptionButtons() {
    if (!this._currentOptions || this._currentOptions.length === 0) {
      return '<span class="text-muted">正在加载选项...</span>';
    }

    return this._currentOptions.map((option, index) => `
      <button
        class="btn spell-option-btn"
        onclick="SpellModule.handleOptionClick(${index})"
        ${this._loadingOptions ? 'disabled' : ''}
      >${option}</button>
    `).join('');
  },

  /* ===========================
     内部方法 - 完成与失败处理
     =========================== */

  /**
   * 当前单词完成（所有空缺填对）
   * @private
   * @param {boolean} success - 是否成功
   */
  _onWordComplete(success) {
    this._stats.total++;

    if (success) {
      this._stats.correct++;

      // 更新预览区为完整单词
      const previewContainer = document.getElementById('spell-preview');
      if (previewContainer) {
        if (this._actualMode === 'partial') {
          previewContainer.innerHTML = `
            <span style="
              display: inline-block; padding: 8px 20px;
              font-size: 2rem; font-weight: 700; color: var(--accent);
              border: 2px solid var(--accent); border-radius: var(--radius-sm);
              background: var(--accent-light); letter-spacing: 2px;
            ">${this.currentWord.word.toLowerCase()}</span>
          `;
        } else if (this._actualMode === 'full') {
          previewContainer.innerHTML = `
            <div class="spell-slot filled" style="font-size: 1.8rem; padding: 0.6rem 1.2rem;">
              ${this.currentWord.word.toLowerCase()}
            </div>
          `;
        }
      }

      // 更新选项区
      const optionsContainer = document.getElementById('spell-options');
      if (optionsContainer) {
        optionsContainer.innerHTML = `
          <div style="text-align: center; color: var(--accent); font-size: 1.1rem; font-weight: 500;">
            &#x2705; 拼写正确！
          </div>
        `;
      }

      // 保存进度（学习模式下由学习流程统一处理）
      if (!this._learnMode && this.currentWord.id && window.progressStorage) {
        progressStorage.saveProgress(this.currentWord.id, 'mastered');
      }

      showToast('拼写正确！', 'success');

      // 自动进入下一个单词
      setTimeout(() => {
        this.nextWord();
      }, 1200);
    }
  },

  /**
   * 当前单词失败（超过最大尝试次数或被跳过）
   * @private
   */
  _onWordFailed() {
    this._stats.total++;
    this._stats.wrong++;
    this._stats.skipped++;

    // 更新预览区显示正确答案
    const previewContainer = document.getElementById('spell-preview');
    if (previewContainer) {
      if (this._actualMode === 'partial') {
        // 显示完整单词，标红空缺部分
        const word = this.currentWord.word.toLowerCase();
        const segments = this._buildDisplaySegments(word, this._blanks);
        previewContainer.innerHTML = segments.map((seg) => {
          if (seg.type === 'text') {
            return `<span style="font-size: 2rem; font-weight: 700; color: var(--text-primary); letter-spacing: 1px;">${seg.text}</span>`;
          } else {
            return `<span style="
              display: inline-block; min-width: 40px; padding: 2px 8px; margin: 0 2px;
              font-size: 2rem; font-weight: 700; color: var(--danger);
              border-bottom: 3px solid var(--danger);
              background: var(--danger-light);
              border-radius: 4px 4px 0 0;
            ">${seg.blank.answer}</span>`;
          }
        }).join('');
      } else if (this._actualMode === 'full') {
        const correctBoxes = this._syllables.map((s) => `
          <div class="spell-slot" style="
            border: 2px solid var(--danger); background: var(--danger-light);
            color: var(--danger);
          ">${s}</div>
        `).join('');
        previewContainer.innerHTML = correctBoxes;
      } else {
        // manual 模式
        previewContainer.innerHTML = `
          <div style="font-size: 1.8rem; font-weight: 700; color: var(--danger);">
            ${this.currentWord.word.toLowerCase()}
          </div>
        `;
      }
    }

    // 更新选项区
    const optionsContainer = document.getElementById('spell-options');
    if (optionsContainer) {
      optionsContainer.innerHTML = `
        <div style="text-align: center;">
          <div style="color: var(--danger); font-size: 1rem; margin-bottom: 0.5rem;">
            &#x2716; 正确答案：<strong style="font-size: 1.2rem;">${this.currentWord.word}</strong>
          </div>
        </div>
      `;
    }

    const feedbackContainer = document.getElementById('spell-feedback');
    if (feedbackContainer) {
      feedbackContainer.innerHTML = '';
    }

    // 保存进度（学习模式下由学习流程统一处理）
    if (!this._learnMode && this.currentWord.id && window.progressStorage) {
      progressStorage.saveProgress(this.currentWord.id, 'review');
    }

    // 学习模式下收集错误单词用于重试
    if (this._learnMode && this.currentWord) {
      this._wrongWords.push(this.currentWord);
    }

    showToast('已跳过，继续下一个', 'info');

    // 自动进入下一个单词
    setTimeout(() => {
      this.nextWord();
    }, 1500);
  },
};

/* ===========================
   注入额外样式（部分挖空模式专用）
   =========================== */
(function _injectSpellStyles() {
  const styleId = 'spell-module-styles-v2';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    /* 选项按钮正确状态 */
    .spell-option-btn.correct {
      background-color: var(--accent) !important;
      border-color: var(--accent) !important;
      color: #ffffff !important;
      pointer-events: none;
    }
    /* 选项按钮错误状态 */
    .spell-option-btn.wrong {
      background-color: var(--danger) !important;
      border-color: var(--danger) !important;
      color: #ffffff !important;
      pointer-events: none;
    }
    /* 抖动动画 */
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-8px); }
      40% { transform: translateX(8px); }
      60% { transform: translateX(-6px); }
      80% { transform: translateX(6px); }
    }
    /* 脉动动画 */
    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 4px var(--accent-light); }
      50% { box-shadow: 0 0 16px var(--accent-light); }
    }
  `;
  document.head.appendChild(style);
})();

/* ===========================
   导出为全局可用
   =========================== */
window.SpellModule = SpellModule;
