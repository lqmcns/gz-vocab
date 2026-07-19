/**
 * ai-service.js - AI 服务封装模块
 * 直接调用 DeepSeek API，无需本地代理
 * API Key 经过混淆处理，参考 biji-zhidao-app 的方案
 * 依赖：CacheStorage（例句缓存）、SettingsStorage（配置）、parseAIResponse（JSON 解析）
 */

/**
 * API Key 解码函数
 * 从混淆字符串中还原真实的 API Key
 * @param {string} s - 混淆后的字符串
 * @returns {string} 解码后的 API Key
 */
function _dk(s){var c='';for(var i=0;i<s.length;i++){if((i+1)%4!==0)c+=s[i];}return atob(c.split('').reverse().join(''))}

class AIService {
  constructor() {
    /**
     * DeepSeek API 地址
     * @type {string}
     */
    this.apiUrl = 'https://api.deepseek.com/chat/completions';

    /**
     * API Key（混淆存储，运行时解码）
     * @type {string}
     */
    this._encodedKey = '=MTmNxAhzNw5MWOllVTrNhJ9jZicJGMg5ADlN2UvWZmcdTO7lF2mMwQ7mYt9s2co';

    // 清理旧的本地代理设置（从旧版本升级时）
    try {
      if (window.settingsStorage) {
        const old = settingsStorage.getSettings();
        if (old.workerUrl && old.workerUrl.includes('localhost:8787')) {
          settingsStorage.saveSetting('workerUrl', '');
          console.log('[AIService] 已清理旧的本地代理设置');
        }
      }
    } catch (e) { /* 忽略 */ }

    /**
     * 风格化例句的系统提示词
     * 借鉴死侍(Deadpool)的说话风格：嘴贱、毒舌、打破第四面墙
     * 但内容不限于死侍的喜好，例句主题可以任意
     * @type {string}
     */
    this.STYLE_PROMPT =
      '请为以下英语单词生成一个例句，使用一种特殊的说话风格。\n' +
      '说话风格要求（借鉴死侍的口吻）：\n' +
      '- 嘴贱、毒舌、阴阳怪气、偶尔自嘲\n' +
      '- 像在跟读者聊天一样，偶尔打破第四面墙（比如"你觉得这个例句无聊吗？我也是"）\n' +
      '- 语气戏谑、不正经，但句子本身语法必须完全正确\n' +
      '- 可以适当带点暧昧和撩拨，或者色色的内容，但不要太过露骨\n' +
      '内容要求：\n' +
      '1. 例句必须包含该单词并体现其正确用法\n' +
      '2. 句子主题不限，可以是校园生活、社交、日常、网络文化等任意话题，不要总是写超级英雄或墨西哥卷饼\n' +
      '3. 语法要求：必须使用高中英语重点语法结构，优先选择以下至少一种：\n' +
      '   - 定语从句（限制性/非限制性，who/which/that/whose/where/when）\n' +
      '   - 名词性从句（主语从句/宾语从句/表语从句/同位语从句）\n' +
      '   - 状语从句（条件/让步/原因/时间/目的/结果）\n' +
      '   - 非谓语动词（doing/done/to do作定语、状语、宾补）\n' +
      '   - 虚拟语气（if虚拟/wish/would rather）\n' +
      '   - 倒装句（部分倒装/完全倒装）\n' +
      '   - 强调句（It is...that...）\n' +
      '4. 难度适合中国高中生，词汇量控制在3500以内\n' +
      '5. 在返回的sentence字段中，用**双星号**将目标单词加粗标记\n' +
      '6. 同时提供中文翻译（翻译也要保持这种贱贱的语气）\n' +
      '格式要求（严格JSON，不要加markdown标记）：{"sentence": "英文例句（目标单词用**加粗**）", "translation": "中文翻译"}';

    /**
     * 改错挑战的系统提示词
     * 生成正规考试风格的改错句子
     * @type {string}
     */
    this.CHALLENGE_PROMPT =
      '你是一个高考英语改错题出题专家。你的任务是造一个含有一处语法错误的英文句子。\n' +
      '\n' +
      '【出题步骤（必须严格执行）】\n' +
      '第一步：先用给定单词造一个语法完全正确的英文句子（称为"正确句"）\n' +
      '第二步：在"正确句"中故意引入恰好一处语法错误，得到"含错句"\n' +
      '第三步：记录你引入的错误类型和修改方法\n' +
      '\n' +
      '【绝对禁止（违反任何一条即为任务失败）】\n' +
      '× 禁止生成没有错误的"含错句"\n' +
      '× 禁止在error_type中填写"无错误"或任何含有"无"字的值\n' +
      '× 禁止在error_explanation中说"没有设置错误""句子没有错误"之类的话\n' +
      '× 禁止让sentence和corrected完全相同\n' +
      '× 禁止引入多处错误\n' +
      '\n' +
      '【难度对应的错误类型（必须匹配）】\n' +
      '- 小白（beginner）：冠词(a/an/the混用或缺失)、介词(in/on/at误用)\n' +
      '- 中级（intermediate）：主谓一致、时态错误\n' +
      '- 高级（advanced）：虚拟语气、倒装、非谓语动词\n' +
      '- 大师（master）：从句引导词、独立主格、复杂句式\n' +
      '\n' +
      '【句子要求】\n' +
      '1. 风格正式规范，模拟高考短文改错题型\n' +
      '2. 必须包含全部给定单词\n' +
      '3. 除故意设置的一处错误外，其余部分必须语法完全正确\n' +
      '4. 如果指定了语法点，错误必须涉及该语法点\n' +
      '5. 提供3条递进式提示（第一条笼统，第三条接近答案）\n' +
      '\n' +
      '【返回格式（严格JSON，不要加markdown标记）】\n' +
      '{"sentence": "含错句（你在正确句中引入了错误的版本）", "corrected": "正确句（你第一步造的原始正确版本）", "error_type": "错误类型名称（如：冠词错误、主谓一致错误，绝不能填无错误）", "error_explanation": "简要说明错在哪里，应如何修正（直接说明，不要说没有错误）", "translation": "正确句的中文翻译", "hints": ["提示1（笼统）", "提示2（中等）", "提示3（接近答案）"], "difficulty": "难度等级"}';

    /**
     * 请求超时时间（毫秒）
     * @type {number}
     * @private
     */
    this._timeout = 30000;
  }

  /**
   * 用AI检查用户改错答案是否正确
   * 不使用1:1字符串匹配，而是让AI判断用户的修改是否语法正确且语义等价
   *
   * @param {string} originalSentence - 原始含错句子
   * @param {string} userAnswer - 用户的修改
   * @param {string} correctAnswer - 标准答案
   * @param {string} errorType - 错误类型
   * @returns {Promise<{isCorrect: boolean, explanation: string}|null>}
   */
  async checkChallengeAnswer(originalSentence, userAnswer, correctAnswer, errorType) {
    if (!this.isConfigured()) {
      // 降级：用简单的字符串匹配
      const normalize = (s) => s.toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ').trim();
      const isCorrect = normalize(userAnswer) === normalize(correctAnswer);
      return { isCorrect, explanation: isCorrect ? '回答正确' : '与标准答案不一致' };
    }

    const prompt =
      '请判断用户的改错答案是否正确。\n' +
      '判断标准：\n' +
      '1. 用户的句子是否修正了原始句子中的语法错误\n' +
      '2. 用户的修改是否语法正确\n' +
      '3. 用户的修改是否保持了原句的语义（可以有同义词替换、连词替换等，只要语法正确且语义等价即可）\n' +
      '4. 如果用户用不同的方式修正了同一个错误，也算正确\n' +
      '5. 如果用户引入了新的语法错误，则算错误\n' +
      '格式要求（严格JSON）：{"is_correct": true/false, "explanation": "简要说明为什么对或错"}';

    const userMessage =
      `原始含错句子: "${originalSentence}"\n` +
      `标准答案: "${correctAnswer}"\n` +
      `错误类型: ${errorType || '未知'}\n` +
      `用户答案: "${userAnswer}"\n` +
      `请判断用户答案是否正确。`;

    try {
      const messages = [
        { role: 'system', content: prompt },
        { role: 'user', content: userMessage },
      ];
      const responseText = await this._callWorker(messages, 0.3, 300);
      if (!responseText) {
        throw new Error('AI 返回空响应');
      }
      const result = parseAIResponse(responseText);
      if (!result) {
        throw new Error('AI 返回格式错误');
      }
      return {
        isCorrect: !!result.is_correct,
        explanation: result.explanation || '',
      };
    } catch (e) {
      console.error('[AIService] 检查答案失败，降级为字符串匹配:', e);
      const normalize = (s) => s.toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ').trim();
      const isCorrect = normalize(userAnswer) === normalize(correctAnswer);
      return { isCorrect, explanation: isCorrect ? '回答正确' : '与标准答案不一致' };
    }
  }

  /**
   * 生成风格化例句
   * 先查缓存，无缓存则调用 AI 生成，结果会自动缓存
   *
   * @param {string} word - 目标单词
   * @param {string} translation - 单词中文释义（可选，提供给 AI 参考上下文）
   * @returns {Promise<{ sentence: string, translation: string, humor_type: string } | null>}
   *
   * @example
   * const result = await aiService.generateStyleExample('abandon', '放弃');
   * // { sentence: "I abandoned my diet plan because...", translation: "...", humor_type: "自嘲" }
   */
  async generateStyleExample(word, translation) {
    if (!word) {
      console.warn('[AIService] generateStyleExample: 单词不能为空');
      return null;
    }

    // 1. 先查 CacheStorage 缓存
    try {
      if (window.CacheStorage) {
        const cacheStorage = new CacheStorage();
        const cached = await cacheStorage.getCachedExample(word);
        if (cached && cached.sentence) {
          console.log('[AIService] 命中缓存:', word);
          return cached;
        }
      }
    } catch (e) {
      console.warn('[AIService] 读取缓存失败:', e);
    }

    // 2. 检查 Worker 是否已配置
    if (!this.isConfigured()) {
      console.warn('[AIService] Worker URL 未配置，无法生成例句');
      showToast('请先在设置中配置 AI Worker URL', 'error');
      return null;
    }

    // 3. 调用 Worker API
    const userMessage = translation
      ? `单词: ${word}\n释义: ${translation}`
      : `单词: ${word}`;

    try {
      const messages = [
        { role: 'system', content: this.STYLE_PROMPT },
        { role: 'user', content: userMessage },
      ];

      const responseText = await this._callWorker(messages);
      if (!responseText) {
        throw new Error('AI 返回了空响应');
      }

      // 4. 解析响应
      const result = parseAIResponse(responseText);
      if (!result || !result.sentence) {
        throw new Error('AI 返回的格式不正确');
      }

      // 5. 缓存结果
      try {
        if (window.CacheStorage) {
          const cacheStorage = new CacheStorage();
          await cacheStorage.cacheExample(word, result);
        }
      } catch (e) {
        console.warn('[AIService] 缓存写入失败:', e);
      }

      // 6. 返回结果
      return {
        sentence: result.sentence,
        translation: result.translation || '',
        humor_type: result.humor_type || '',
      };
    } catch (e) {
      console.error('[AIService] 生成风格化例句失败:', e);
      showToast('AI 生成例句失败: ' + e.message, 'error');
      return null;
    }
  }

  /**
   * 生成改错挑战句子
   * 用给定单词造一个包含语法错误的英文句子
   *
   * @param {string[]} words - 英语单词数组
   * @param {string[]} translations - 对应的中文释义数组（可选）
   * @param {object} [options] - 可选配置
   * @param {string} [options.difficulty] - 难度：'beginner'|'intermediate'|'advanced'|'master'
   * @param {string} [options.grammarPoint] - 自定义语法点
   * @returns {Promise<object|null>}
   */
  async generateChallengeSentence(words, translations, options = {}) {
    if (!Array.isArray(words) || words.length === 0) {
      console.warn('[AIService] generateChallengeSentence: 单词列表不能为空');
      return null;
    }

    if (!this.isConfigured()) {
      console.warn('[AIService] Worker URL 未配置，无法生成挑战句子');
      showToast('请先在设置中配置 AI 服务地址', 'error');
      return null;
    }

    const difficultyNames = {
      beginner: '小白（初级：冠词/介词错误）',
      intermediate: '中级（主谓一致/时态错误）',
      advanced: '高级（虚拟语气/倒装/非谓语）',
      master: '大师（从句/独立主格/复杂结构）',
    };
    const difficulty = options.difficulty || 'intermediate';
    const grammarPoint = options.grammarPoint || '';

    let userMessage = `请用以下单词造句: ${words.join(', ')}`;
    if (Array.isArray(translations) && translations.length > 0) {
      const wordList = words.map((w, i) => {
        const trans = translations[i] || '';
        return trans ? `${w}(${trans})` : w;
      });
      userMessage = `请用以下单词造句: ${wordList.join(', ')}`;
    }
    userMessage += `\n难度等级: ${difficultyNames[difficulty] || difficulty}`;
    if (grammarPoint) {
      userMessage += `\n指定语法点: ${grammarPoint}（错误必须涉及此语法点）`;
    }

    try {
      const messages = [
        { role: 'system', content: this.CHALLENGE_PROMPT },
        { role: 'user', content: userMessage },
      ];

      const responseText = await this._callWorker(messages, 0.7, 800);
      if (!responseText) {
        throw new Error('AI 返回了空响应');
      }

      const result = parseAIResponse(responseText);
      if (!result || !result.sentence || !result.corrected) {
        throw new Error('AI 返回的格式不正确');
      }

      // === 多重验证：确保题目有效 ===
      const normalize = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

      // 检测"无错误"模式：error_type 或 error_explanation 中出现关键词
      const hasNoErrorPattern = (r) => {
        if (!r) return true;
        const et = (r.error_type || '').toLowerCase();
        const ex = (r.error_explanation || '').toLowerCase();
        // error_type 含"无错误""没有错误""no error"
        if (et.includes('无错误') || et.includes('无') || et.includes('no error') || et.includes('none')) return true;
        // error_explanation 明确说"没有设置错误""句子没有错误""没有语法错误"
        if (ex.includes('没有设置错误') || ex.includes('没有错误') || ex.includes('没有语法错误') ||
            ex.includes('没有故意') || ex.includes('所有单词都已正确') || ex.includes('语法结构完整')) return true;
        return false;
      };

      // 验证1：sentence 和 corrected 必须不同
      const sameSentence = normalize(result.sentence) === normalize(result.corrected);
      // 验证2：不能出现"无错误"模式
      const noErrorFlag = hasNoErrorPattern(result);

      if (sameSentence || noErrorFlag) {
        console.warn(`[AIService] 题目无效（${sameSentence ? '句子相同' : '无错误标记'}），重试一次`);
        // 重试：用更高 temperature 和额外指令
        const retryMessages = [
          { role: 'system', content: this.CHALLENGE_PROMPT },
          { role: 'user', content: userMessage + '\n\n【重要提醒】你上次生成失败了。这次必须确保：1）sentence中确实有一处语法错误 2）error_type绝不能含"无"字 3）sentence和corrected必须不同' },
        ];
        const retryResponse = await this._callWorker(retryMessages, 0.9, 800);
        if (retryResponse) {
          const retryResult = parseAIResponse(retryResponse);
          if (retryResult && retryResult.sentence && retryResult.corrected &&
              normalize(retryResult.sentence) !== normalize(retryResult.corrected) &&
              !hasNoErrorPattern(retryResult)) {
            return {
              sentence: retryResult.sentence,
              corrected: retryResult.corrected,
              error_type: retryResult.error_type || '语法错误',
              error_explanation: retryResult.error_explanation || '',
              translation: retryResult.translation || '',
              hints: Array.isArray(retryResult.hints) ? retryResult.hints : [],
              difficulty: retryResult.difficulty || difficulty,
            };
          }
        }
        // 如果重试也失败，但原始结果至少 sentence≠corrected，就强制修正后使用
        if (!sameSentence) {
          result.error_type = result.error_type || '语法错误';
          if (result.error_type.includes('无') || result.error_type.includes('no')) {
            result.error_type = '语法错误';
          }
          // 清理 error_explanation 中的"无错误"措辞
          if (result.error_explanation && (result.error_explanation.includes('没有') || result.error_explanation.includes('无错误'))) {
            result.error_explanation = `句子"${result.sentence}"中存在一处语法错误，正确版本为"${result.corrected}"。`;
          }
        } else {
          throw new Error('AI 未能生成有效的改错题目，请重试');
        }
      }

      return {
        sentence: result.sentence,
        corrected: result.corrected,
        error_type: result.error_type || '',
        error_explanation: result.error_explanation || '',
        translation: result.translation || '',
        hints: Array.isArray(result.hints) ? result.hints : [],
        difficulty: result.difficulty || difficulty,
      };
    } catch (e) {
      console.error('[AIService] 生成改错挑战失败:', e);
      showToast('AI 生成挑战失败: ' + e.message, 'error');
      return null;
    }
  }

  /**
   * 调用 DeepSeek API
   * 直接从前端发送请求到 DeepSeek API 服务器
   *
   * @private
   * @param {Array<{role: string, content: string}>} messages - OpenAI 格式的消息数组
   * @param {number} temperature - 生成温度，默认0.8（较高的值使输出更有创意）
   * @param {number} max_tokens - 最大 token 数，默认500
   * @returns {Promise<string>} AI 生成的文本内容
   * @throws {Error} 网络异常、API 错误、响应格式异常
   */
  async _callWorker(messages, temperature = 0.8, max_tokens = 500) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('消息不能为空');
    }

    // 解码 API Key
    const apiKey = _dk(this._encodedKey);

    // 构建请求体
    const body = {
      model: 'deepseek-chat',
      messages: messages,
      temperature: temperature,
      max_tokens: max_tokens,
    };

    console.log('[AIService] 发送请求到 DeepSeek API');

    try {
      // 使用 AbortController 实现超时控制
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, this._timeout);

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // 清除超时定时器
      clearTimeout(timeoutId);

      // 检查 HTTP 响应状态
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `API 请求失败: HTTP ${response.status}` +
          (errorText ? ` - ${errorText.substring(0, 200)}` : '')
        );
      }

      // 解析响应 JSON
      let data;
      try {
        data = await response.json();
      } catch (e) {
        throw new Error('API 返回的不是有效的 JSON');
      }

      // 提取 AI 生成的内容
      // 兼容 OpenAI 格式: data.choices[0].message.content
      if (data && data.choices && data.choices.length > 0 && data.choices[0].message) {
        return data.choices[0].message.content || '';
      }

      // 兼容可能的直接返回格式: data.content 或 data.result
      if (data && data.content) {
        return data.content;
      }
      if (data && data.result) {
        return typeof data.result === 'string' ? data.result : JSON.stringify(data.result);
      }

      throw new Error('API 响应格式异常: 无法提取 AI 内容');
    } catch (e) {
      // 区分超时错误和其他错误
      if (e.name === 'AbortError') {
        throw new Error(`请求超时（${this._timeout / 1000}秒），请检查网络连接`);
      }

      // 重新抛出已知错误
      if (e.message.startsWith('API') || e.message.startsWith('请求超时')) {
        throw e;
      }

      // 处理网络异常
      if (e instanceof TypeError && e.message.includes('fetch')) {
        throw new Error('网络连接失败，请检查网络是否正常');
      }

      throw e;
    }
  }

  /**
   * AI 对话（查词界面用）
   * 以单词学习助手的身份回答用户关于单词的用法、语法、辨析等问题
   * @param {Array<{role: string, content: string}>} messages - OpenAI 格式消息数组（含 system + 历史消息）
   * @param {number} [temperature=0.5] - 生成温度
   * @param {number} [maxTokens=600] - 最大 token
   * @returns {Promise<string>} AI 回复内容
   */
  async chat(messages, temperature = 0.5, maxTokens = 600) {
    return await this._callWorker(messages, temperature, maxTokens);
  }

  /**
   * 检查 AI 服务是否可用
   * @returns {boolean} 是否已配置
   */
  isConfigured() {
    return !!this._encodedKey && this._encodedKey.length > 10;
  }

  /**
   * 设置自定义 API 地址（可选，一般不需要）
   *
   * @param {string} url - API 地址
   */
  setWorkerUrl(url) {
    if (!url || typeof url !== 'string') {
      return;
    }

    const trimmed = url.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      showToast('地址必须以 http:// 或 https:// 开头', 'error');
      return;
    }

    this.apiUrl = trimmed;

    // 保存到 SettingsStorage
    try {
      if (window.settingsStorage) {
        settingsStorage.saveSetting('workerUrl', trimmed);
        console.log('[AIService] API 地址已保存:', trimmed);
      }
    } catch (e) {
      console.error('[AIService] 保存 API 地址失败:', e);
    }
  }

  /**
   * 获取当前配置的 API 地址
   * @returns {string} 当前 API 地址
   */
  getWorkerUrl() {
    return this.apiUrl;
  }
}

/* ===========================
   创建全局实例并挂载到 window
   =========================== */
window.AIService = AIService;
window.aiService = new AIService();
