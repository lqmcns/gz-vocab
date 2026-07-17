/**
 * app.js - 主控制器
 * 负责应用初始化、路由管理、首页渲染等核心逻辑
 * 使用 ES Module 模式加载（依赖全局挂载的模块）
 */

/* ===========================
   全局状态
   =========================== */
const AppState = {
  currentBatch: [],      // 当前学习批次单词列表
  currentIndex: 0,       // 当前批次中的单词索引
  currentSection: 'home', // 当前显示的 section
  isLoaded: false,       // 词库是否已加载
  // 学习流程状态
  // { phase: 'study'|'spell'|'complete', words: [], studyIndex: 0, spellQueue: [], round: 0, aiExamples: {} }
  learnFlow: null,
};

/* ===========================
   服务实例
   =========================== */
const wordService = new WordDataService();
const progressStorage = new ProgressStorage();
const settingsStorage = new SettingsStorage();
const cacheStorage = new CacheStorage();
const vocabTestStorage = new VocabTestStorage();
// 教材服务使用全局已创建的实例（共享缓存数据）
const textbookService = window.textbookService;

/* ===========================
   初始化
   =========================== */
async function init() {
  console.log('[App] 初始化中...');

  // 显示加载状态
  showLoading(true);

  try {
    // 1. 恢复设置（如暗色模式）
    restoreSettings();

    // 1.5 初始化语音引擎（解决首次发音模糊和 voices 异步加载问题）
    initSpeechEngine();

    // 2. 加载词库
    await wordService.loadDictionary();
    AppState.isLoaded = true;

    // 2.5 加载教材数据（非阻塞，失败不影响主流程）
    if (textbookService) {
      textbookService.load().catch((e) => {
        console.warn('[App] 教材数据加载失败，单词表功能将不可用:', e);
      });
    }

    // 3. 监听 hash 路由变化
    window.addEventListener('hashchange', handleRouteChange);

    // 4. 初始路由
    handleRouteChange();

    // 5. 渲染首页
    if (AppState.currentSection === 'home') {
      renderHome();
    }

    console.log('[App] 初始化完成');
  } catch (error) {
    console.error('[App] 初始化失败:', error);
    showToast('应用初始化失败，请刷新页面重试', 'error');
  } finally {
    showLoading(false);
  }
}

/* ===========================
   路由管理
   =========================== */

/**
 * 处理 hash 路由变化
 * 从 URL hash 中解析目标 section 并导航
 */
function handleRouteChange() {
  const hash = window.location.hash || '#/home';
  // 解析 section 名称：#/home -> home
  const section = hash.replace('#/', '').replace('#', '');

  // 验证 section 是否有效
  const validSections = ['home', 'learn', 'spell', 'challenge', 'wordlist', 'learned', 'search'];
  const targetSection = validSections.includes(section) ? section : 'home';

  navigate(targetSection);
}

/* ===========================
   自定义模态框（替代浏览器 confirm/alert）
   =========================== */

/**
 * 显示自定义确认对话框
 * @param {object} options - 配置项
 * @param {string} options.title - 标题
 * @param {string} options.message - 消息内容（支持 HTML）
 * @param {string} [options.confirmText='确认'] - 确认按钮文字
 * @param {string} [options.cancelText='取消'] - 取消按钮文字
 * @param {string} [options.confirmClass='btn-primary'] - 确认按钮样式类
 * @param {boolean} [options.showCancel=true] - 是否显示取消按钮
 * @returns {Promise<boolean>} 用户是否点击了确认
 */
function showCustomConfirm(options) {
  return new Promise((resolve) => {
    const {
      title = '提示',
      message = '',
      confirmText = '确认',
      cancelText = '取消',
      confirmClass = 'btn-primary',
      showCancel = true,
    } = options || {};

    // 创建遮罩
    const overlay = document.createElement('div');
    overlay.className = 'custom-modal-overlay';
    overlay.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'background:rgba(0,0,0,0.4);z-index:9999;display:flex;' +
      'align-items:center;justify-content:center;' +
      'animation:fadeIn 0.15s ease;';

    // 创建对话框
    const modal = document.createElement('div');
    modal.className = 'custom-modal';
    modal.style.cssText =
      'background:var(--bg-primary);border-radius:12px;padding:1.5rem;' +
      'max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.2);' +
      'animation:slideUp 0.2s ease;';

    modal.innerHTML = `
      <div style="font-size:1.1rem;font-weight:600;color:var(--text-primary);margin-bottom:0.75rem;">
        ${title}
      </div>
      <div style="font-size:0.9rem;color:var(--text-secondary);line-height:1.6;margin-bottom:1.25rem;">
        ${message}
      </div>
      <div style="display:flex;gap:0.5rem;justify-content:flex-end;">
        ${showCancel ? `<button class="btn btn-ghost" data-action="cancel">${cancelText}</button>` : ''}
        <button class="btn ${confirmClass}" data-action="confirm">${confirmText}</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // 初始化模态框内图标
    if (window.initIcons) initIcons(modal);

    const close = (result) => {
      overlay.style.animation = 'fadeOut 0.15s ease';
      setTimeout(() => {
        document.body.removeChild(overlay);
        resolve(result);
      }, 150);
    };

    modal.querySelector('[data-action="confirm"]').addEventListener('click', () => close(true));
    if (showCancel) {
      modal.querySelector('[data-action="cancel"]').addEventListener('click', () => close(false));
    }
    // 点击遮罩关闭（仅当有取消按钮时）
    if (showCancel) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(false);
      });
    }
  });
}

/**
 * 导航到指定 section
 * @param {string} section - section 名称 (home/learn/spell/challenge)
 */
function navigate(section) {
  // 如果正在学习中（study或spell阶段），切换到其他页面时弹出自定义确认
  if (AppState.learnFlow && AppState.learnFlow.phase !== 'complete' &&
      AppState.learnFlow.phase !== 'idle' &&
      section !== 'learn' && AppState.currentSection === 'learn') {
    // 使用自定义模态框替代浏览器 confirm
    showCustomConfirm({
      title: '退出学习',
      message: '确定要退出当前学习吗？<br><br>' +
        '<small style="color:var(--text-muted);">已拼对的单词已自动保存进度，未完成拼写的单词不会计入已学会列表。下次进入此单元时可选择继续学习。</small>',
      confirmText: '退出并保存',
      cancelText: '继续学习',
    }).then((confirmed) => {
      if (confirmed) {
        // 保存学习进度到 localStorage
        saveLearnFlowProgress();
        AppState.learnFlow = null;
        navigate(section); // 重新导航（这次不会再弹窗）
      }
      // 如果取消，什么都不做，留在当前页
    });
    return; // 阻止本次导航
  }

  AppState.currentSection = section;

  // 更新 URL hash（不触发 hashchange 事件）
  const currentHash = window.location.hash;
  const targetHash = `#/${section}`;
  if (currentHash !== targetHash) {
    history.replaceState(null, '', targetHash);
  }

  // 切换 section 显示
  document.querySelectorAll('.section').forEach((el) => {
    el.classList.remove('active');
  });

  const targetEl = document.getElementById(section);
  if (targetEl) {
    targetEl.classList.add('active');
  }

  // 更新导航栏高亮
  document.querySelectorAll('.navbar-nav a').forEach((link) => {
    link.classList.remove('active');
    if (link.getAttribute('href') === `#/${section}`) {
      link.classList.add('active');
    }
  });

  // 根据目标 section 执行渲染
  switch (section) {
    case 'home':
      renderHome();
      break;
    case 'learn':
      renderLearn();
      break;
    case 'spell':
      renderSpell();
      break;
    case 'challenge':
      renderChallenge();
      break;
    case 'wordlist':
      renderWordList();
      break;
    case 'learned':
      renderLearnedWords();
      break;
    case 'search':
      renderSearch();
      break;
  }
}

/* ===========================
   设置管理
   =========================== */

/**
 * 恢复用户设置
 */
function restoreSettings() {
  const settings = settingsStorage.getSettings();

  // 应用暗色模式
  if (settings.darkMode) {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

/**
 * 切换暗色模式
 */
function toggleDarkMode() {
  const settings = settingsStorage.getSettings();
  const newMode = !settings.darkMode;
  settingsStorage.saveSetting('darkMode', newMode);

  if (newMode) {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }

  showToast(newMode ? '已切换到暗色模式' : '已切换到亮色模式', 'info');
}

/**
 * 打开/关闭设置面板
 */
function toggleSettings(open) {
  const panel = document.getElementById('settings-panel');
  const overlay = document.getElementById('settings-overlay');
  if (!panel || !overlay) return;

  if (open === undefined) {
    open = !panel.classList.contains('open');
  }

  if (open) {
    panel.classList.add('open');
    overlay.classList.add('open');
    // 打开时同步当前设置到控件
    syncSettingsUI();
  } else {
    panel.classList.remove('open');
    overlay.classList.remove('open');
  }
}

/**
 * 同步设置面板的 UI 控件值与当前设置
 */
function syncSettingsUI() {
  const settings = settingsStorage.getSettings();
  const batchSizeInput = document.getElementById('setting-batch-size');
  const voiceRateInput = document.getElementById('setting-voice-rate');
  const voiceRateDisplay = document.getElementById('voice-rate-display');
  const darkModeToggle = document.getElementById('setting-dark-mode');
  const spellModeSelect = document.getElementById('setting-spell-mode');

  if (batchSizeInput) batchSizeInput.value = settings.batchSize;
  if (voiceRateInput) voiceRateInput.value = settings.voiceRate;
  if (voiceRateDisplay) voiceRateDisplay.textContent = settings.voiceRate + 'x';
  if (darkModeToggle) darkModeToggle.checked = settings.darkMode;
  if (spellModeSelect) spellModeSelect.value = settings.spellMode || 'partial';
  const workerUrlInput = document.getElementById('setting-worker-url');
  if (workerUrlInput) workerUrlInput.value = settings.workerUrl || 'https://api.deepseek.com/chat/completions';
}

/**
 * 更新每批学习数量设置
 */
function updateBatchSize(value) {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 1 || num > 50) {
    showToast('每批数量需在 1-50 之间', 'error');
    return;
  }
  settingsStorage.saveSetting('batchSize', num);
  showToast(`每批学习数量已设为 ${num}`, 'success');
}

/**
 * 更新语音朗读速度设置
 */
function updateVoiceRate(value) {
  const rate = parseFloat(value);
  if (isNaN(rate) || rate < 0.5 || rate > 2.0) return;
  settingsStorage.saveSetting('voiceRate', rate);
  const display = document.getElementById('voice-rate-display');
  if (display) display.textContent = rate.toFixed(1) + 'x';
}

/**
 * 更新拼写模式设置
 */
function updateSpellMode(value) {
  const validModes = ['partial', 'full', 'manual'];
  if (!validModes.includes(value)) return;
  settingsStorage.saveSetting('spellMode', value);
  const modeNames = {
    partial: '部分挖空选词',
    full: '完整音节选词',
    manual: '手动拼写',
  };
  showToast(`拼写方式已设为：${modeNames[value]}`, 'success');
}

/**
 * 更新 AI 代理服务地址
 */
function updateWorkerUrl(value) {
  const url = value.trim();
  if (window.aiService) {
    aiService.setWorkerUrl(url);
  }
  if (url) {
    settingsStorage.saveSetting('workerUrl', url);
  } else {
    settingsStorage.saveSetting('workerUrl', '');
  }
}

/**
 * 确认并清除学习进度（二次确认）
 */
async function confirmClearProgress() {
  const first = await showCustomConfirm({
    title: '清除学习进度',
    message: '确定要清除所有学习进度吗？<br><br>' +
      '<small style="color:var(--text-muted);">所有已学单词、学习记录都将被删除，此操作不可撤销。</small>',
    confirmText: '继续',
    confirmClass: 'btn-danger',
  });
  if (!first) return;

  const second = await showCustomConfirm({
    title: '再次确认',
    message: '真的要清除全部进度吗？<br><br>' +
      '<small style="color:var(--text-muted);">点击"确定"将永久删除所有学习数据。</small>',
    confirmText: '确定清除',
    confirmClass: 'btn-danger',
  });
  if (!second) return;

  progressStorage.clearProgress();
  showToast('学习进度已清除', 'success');
  // 刷新首页统计
  if (AppState.currentSection === 'home') {
    renderHome();
  }
}

/**
 * 确认并清除缓存数据
 */
async function confirmClearCache() {
  const confirmed = await showCustomConfirm({
    title: '清除缓存',
    message: '确定要清除所有AI例句缓存吗？<br><br>' +
      '<small style="color:var(--text-muted);">不影响学习进度，下次使用时会重新生成。</small>',
    confirmText: '清除缓存',
    confirmClass: 'btn-secondary',
  });
  if (confirmed) {
    try {
      await cacheStorage.clearCache();
      showToast('AI例句缓存已清除', 'success');
    } catch (e) {
      console.error('[App] 清除缓存失败:', e);
      showToast('缓存清除完成（部分数据可能已失效）', 'info');
    }
  }
}

/* ===========================
   首页渲染
   =========================== */

/**
 * 每日金句预设数据（英文原文 + 作者 + 中文翻译）
 * 内容积极向上，适合学习者
 */
const DAILY_QUOTES = [
  { en: 'The only way to do great work is to love what you do.', author: 'Steve Jobs', zh: '做伟大工作的唯一方法就是热爱你所做的事。' },
  { en: 'Success is not final, failure is not fatal: it is the courage to continue that counts.', author: 'Churchill', zh: '成功不是终点，失败也不是终结，继续前行的勇气才是一切。' },
  { en: 'The future belongs to those who believe in the beauty of their dreams.', author: 'Eleanor Roosevelt', zh: '未来属于那些相信梦想之美的人。' },
  { en: 'Believe you can and you\'re halfway there.', author: 'Theodore Roosevelt', zh: '相信自己能做到，你就已经成功了一半。' },
  { en: 'The expert in anything was once a beginner.', author: 'Helen Hayes', zh: '任何领域的专家都曾是初学者。' },
  { en: 'Education is the most powerful weapon which you can use to change the world.', author: 'Nelson Mandela', zh: '教育是你能用来改变世界的最强有力的武器。' },
  { en: 'The journey of a thousand miles begins with a single step.', author: 'Lao Tzu', zh: '千里之行，始于足下。' },
  { en: 'Don\'t watch the clock; do what it does. Keep going.', author: 'Sam Levenson', zh: '不要盯着时钟看，要像它一样，一直向前走。' },
  { en: 'Learning never exhausts the mind.', author: 'Leonardo da Vinci', zh: '学习永远不会使心灵枯竭。' },
  { en: 'The more that you read, the more things you will know. The more that you learn, the more places you\'ll go.', author: 'Dr. Seuss', zh: '你读得越多，知道得就越多；你学得越多，能去的地方就越广。' },
  { en: 'It does not matter how slowly you go as long as you do not stop.', author: 'Confucius', zh: '走得多慢没关系，只要你不停下脚步。' },
  { en: 'The only person you are destined to become is the person you decide to be.', author: 'Ralph Waldo Emerson', zh: '你注定要成为的人，就是你自己决定要成为的那个人。' },
  { en: 'Every accomplishment starts with the decision to try.', author: 'Unknown', zh: '每一次成就都始于尝试的决定。' },
  { en: 'Knowledge is power.', author: 'Francis Bacon', zh: '知识就是力量。' },
  { en: 'The beautiful thing about learning is that no one can take it away from you.', author: 'B.B. King', zh: '学习的美好之处在于，没有人能把它从你身上夺走。' },
  { en: 'Patience, persistence, and perspiration make an unbeatable combination for success.', author: 'Napoleon Hill', zh: '耐心、坚持与汗水，是通往成功无可匹敌的组合。' },
];

/**
 * 根据当天日期选择一条每日金句
 * 用一年中的第几天作为索引，保证每天显示同一条，且每天轮换
 */
function getDailyQuote() {
  const now = new Date();
  // 计算今天是当年的第几天（1 起算）
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  const index = dayOfYear % DAILY_QUOTES.length;
  return DAILY_QUOTES[index];
}

/**
 * 渲染首页仪表板
 */
function renderHome() {
  const section = document.getElementById('home');
  if (!section) return;

  const totalCount = wordService.getTotalCount();
  const stats = progressStorage.getProgressStats();
  const todayStr = new Date().toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  // 获取今日金句
  const dailyQuote = getDailyQuote();

  // 计算总体进度百分比
  const progressPercent = totalCount > 0
    ? Math.round(((stats.mastered + stats.learning) / totalCount) * 100)
    : 0;

  section.innerHTML = `
    <!-- 欢迎区域 -->
    <div class="mb-3">
      <h2 style="font-size: 1.5rem; margin-bottom: 0.25rem;">
        ${getGreeting()}
      </h2>
      <p class="text-muted" style="font-size: 0.9rem;">${todayStr}</p>
    </div>

    <!-- 每日金句 -->
    <div class="daily-quote" style="margin: 0 0 1.25rem; padding: 0.6rem 0.9rem; border-left: 3px solid var(--accent); background: var(--bg-secondary); border-radius: 6px;">
      <div style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 0.3rem; letter-spacing: 0.05em;">每日金句</div>
      <div style="font-size: 0.85rem; color: var(--text-muted); font-style: italic; line-height: 1.5;">
        “${dailyQuote.en}”
        <span style="font-style: normal; color: var(--border);">— ${dailyQuote.author}</span>
      </div>
      <div style="font-size: 0.8rem; color: var(--text-muted); font-style: italic; margin-top: 0.25rem; line-height: 1.5;">
        ${dailyQuote.zh}
      </div>
    </div>

    <!-- 统计卡片网格 -->
    <div class="dashboard">
      <div class="stat-card accent">
        <div class="stat-icon">${Icon.wordlist}</div>
        <div class="stat-value">${totalCount}</div>
        <div class="stat-label">总词数</div>
      </div>
      <div class="stat-card accent">
        <div class="stat-icon">${Icon.check}</div>
        <div class="stat-value">${stats.mastered}</div>
        <div class="stat-label">已掌握</div>
      </div>
      <div class="stat-card warning" style="cursor: pointer;" onclick="VocabTestModule.start()">
        <div class="stat-icon">${Icon.challenge}</div>
        <div class="stat-value" style="font-size: 1.2rem;">开始检测</div>
        <div class="stat-label">词汇量检测</div>
      </div>
      <div class="stat-card info">
        <div class="stat-icon">${Icon.refresh}</div>
        <div class="stat-value">${stats.review}</div>
        <div class="stat-label">待复习</div>
      </div>
    </div>

    <!-- 总进度 -->
    <div class="card mb-3">
      <div class="card-header">${Icon.learned} 学习总进度</div>
      <div class="progress-labeled">
        <div class="progress-bar">
          <div class="progress-bar-fill" style="width: ${progressPercent}%"></div>
        </div>
        <span class="progress-text">${progressPercent}%</span>
      </div>
      <p class="text-muted mt-1" style="font-size: 0.85rem;">
        已学习 ${stats.mastered + stats.learning} / ${totalCount} 个单词
      </p>
    </div>

    <!-- 快速操作 -->
    <div class="card">
      <div class="card-header">${Icon.challenge} 快速开始</div>
      <div class="quick-actions">
        <button class="quick-action-btn" onclick="VocabTestModule.start()">
          <span class="action-icon">${Icon.vocabTest}</span>
          <span class="action-label">词汇量检测</span>
        </button>
        <button class="quick-action-btn" onclick="startReview()">
          <span class="action-icon">${Icon.refresh}</span>
          <span class="action-label">复习单词</span>
        </button>
        <button class="quick-action-btn" onclick="navigate('spell')">
          <span class="action-icon">${Icon.spell}</span>
          <span class="action-label">拼写训练</span>
        </button>
        <button class="quick-action-btn" onclick="navigate('challenge')">
          <span class="action-icon">${Icon.challenge}</span>
          <span class="action-label">改错挑战</span>
        </button>
        <button class="quick-action-btn" onclick="navigate('learn')">
          <span class="action-icon">${Icon.learn}</span>
          <span class="action-label">学习新词</span>
        </button>
        <button class="quick-action-btn" onclick="navigate('search')">
          <span class="action-icon">${Icon.search}</span>
          <span class="action-label">快速查词</span>
        </button>
        <button class="quick-action-btn" onclick="navigate('wordlist')">
          <span class="action-icon">${Icon.wordlist}</span>
          <span class="action-label">单词表</span>
        </button>
        <button class="quick-action-btn" onclick="navigate('learned')">
          <span class="action-icon">${Icon.learned}</span>
          <span class="action-label">已学单词</span>
        </button>
      </div>
    </div>
  `;
  // 初始化动态生成的图标
  if (window.initIcons) initIcons();
}

/**
 * 根据时间段获取问候语
 */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了，注意休息';
  if (hour < 9) return '早上好，开始背单词吧';
  if (hour < 12) return '上午好，加油学习';
  if (hour < 14) return '中午好，适当休息一下';
  if (hour < 18) return '下午好，继续努力';
  if (hour < 22) return '晚上好，坚持就是胜利';
  return '夜深了，注意休息';
}

/**
 * 开始复习已有单词
 */
/**
 * 全局查找单词数据（跨数据源）
 * 优先从 wordService 查找，找不到则从 textbookService 词典查找
 * @param {number} id - 单词ID
 * @param {string} [wordText] - 单词文本（可选，用于教材单词的 fallback 查找）
 * @returns {object|null} 单词数据对象
 */
function getWordDataGlobal(id, wordText) {
  // 1. 先从主词库查找
  if (window.wordService && wordService.isLoaded()) {
    const word = wordService.getWordById(id);
    if (word) return word;
  }

  // 2. 主词库找不到，用单词文本从教材词典查找
  if (wordText && window.textbookService && textbookService._dict) {
    const lower = wordText.toLowerCase().trim();
    if (textbookService._dictMap && textbookService._dictMap[lower]) {
      const entry = textbookService._dictMap[lower];
      return {
        id: id,
        word: entry.word || wordText,
        phonetic: entry.phonetic || '',
        translation: entry.translation || '',
        pos: entry.pos || '',
        collins: entry.collins || 0,
        oxford: entry.oxford || 0,
      };
    }
    // 3. 教材词典也没有，尝试从 gk3500 查找
    if (window.wordService && wordService._dictionary) {
      if (!textbookService._gkMap) {
        const dict = wordService._dictionary;
        textbookService._gkMap = {};
        for (const entry of dict) {
          if (entry && entry.word) {
            textbookService._gkMap[entry.word.toLowerCase()] = entry;
          }
        }
      }
      if (textbookService._gkMap[lower]) {
        const entry = textbookService._gkMap[lower];
        return {
          id: id,
          word: entry.word || wordText,
          phonetic: entry.phonetic || '',
          translation: entry.translation || '',
          pos: entry.pos || '',
          collins: entry.collins || 0,
          oxford: entry.oxford || 0,
        };
      }
    }
  }

  return null;
}

function startReview() {
  const progress = progressStorage.getAllProgress();
  const reviewEntries = Object.entries(progress)
    .filter(([id, item]) => {
      return item.status === 'review' || item.status === 'learning' || item.status === 'mastered';
    });

  if (reviewEntries.length === 0) {
    showToast('暂无需要复习的单词，快去学习新词吧', 'info');
    return;
  }

  const settings = settingsStorage.getSettings();
  const batchCount = Math.min(settings.batchSize, reviewEntries.length);

  // 随机选一批
  const shuffled = [...reviewEntries].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, batchCount);

  // 跨数据源查找单词数据
  const batchWords = selected.map(([id, item]) => {
    return getWordDataGlobal(parseInt(id, 10), item.word);
  }).filter(Boolean);

  if (batchWords.length === 0) {
    showToast('无法获取单词数据，请尝试重新学习', 'error');
    console.warn('[startReview] 无法查找单词数据', selected);
    return;
  }

  // 使用学习流程（复习模式，分批学习）
  AppState.learnFlow = createLearnFlow(batchWords, { isReview: true });

  navigate('learn');
}

/* ===========================
   学习页面 - 标准学习流程（欧陆词典风格分批学习）
   流程：每10个单词为一批 → 学习卡片 → 拼写测试 → 下一批学习（含上批错词）→ 全部完成
   单词必须"学完+拼写正确"才算已掌握
   =========================== */

/**
 * 每批学习的单词数量
 */
const LEARN_BATCH_SIZE = 10;

/**
 * 将单词数组按指定大小分批
 * @param {Array} words - 单词数组
 * @param {number} batchSize - 每批大小
 * @returns {Array[]} 分批后的二维数组
 */
function splitIntoBatches(words, batchSize) {
  const batches = [];
  for (let i = 0; i < words.length; i += batchSize) {
    batches.push(words.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * 创建学习流程状态对象
 * @param {Array} words - 本次学习的全部单词
 * @param {object} [options] - 可选参数
 * @param {boolean} [options.fromWordList] - 是否从单词表进入
 * @param {boolean} [options.isReview] - 是否复习模式
 * @returns {object} learnFlow 状态对象
 */
function createLearnFlow(words, options) {
  options = options || {};
  const batches = splitIntoBatches(words, LEARN_BATCH_SIZE);
  return {
    phase: 'study',
    words: words,                // 全部单词（用于 find 查找）
    batches: batches,            // 分批后的二维数组
    batchIndex: 0,               // 当前批次索引
    currentBatch: batches[0] || [],  // 当前正在学习的批次
    studyIndex: 0,               // 当前批次内的单词索引
    carriedWrongWords: [],       // 上批拼写错误的单词（带入下批拼写）
    masteredWords: [],           // 已掌握的单词（学完+拼对）
    studiedWordIds: {},          // 已学习过的单词ID（用于去重）
    aiExamples: {},              // AI例句缓存
    round: 0,                    // 拼写轮次计数
    fromWordList: options.fromWordList || false,
    isReview: options.isReview || false,
  };
}

/**
 * 渲染学习页面（根据学习流程状态分发）
 */
function renderLearn() {
  const section = document.getElementById('learn');
  if (!section) return;

  // 如果学习流程不存在或已完成，显示开始界面
  if (!AppState.learnFlow || AppState.learnFlow.phase === 'idle') {
    renderLearnStart();
    return;
  }

  // 拼写阶段由 SpellModule 渲染
  if (AppState.learnFlow.phase === 'spell') {
    return;
  }

  // 完成阶段
  if (AppState.learnFlow.phase === 'complete') {
    renderLearnComplete();
    return;
  }

  // 学习阶段：显示单词卡片
  if (AppState.learnFlow.phase === 'study') {
    renderLearnStudy();
    return;
  }
}

/**
 * 渲染学习开始界面（含教材/词汇范围选择）
 */
function renderLearnStart() {
  const section = document.getElementById('learn');
  if (!section) return;

  const settings = settingsStorage.getSettings();
  const spellModeNames = {
    partial: '部分挖空选词',
    full: '完整音节选词',
    manual: '手动拼写',
  };

  // 教材选项
  let bookOptions = '';
  if (textbookService && textbookService.isLoaded()) {
    const books = textbookService.getBooks();
    bookOptions = books.map((b) =>
      `<option value="${b.book}">${b.name}（${b.unitCount}单元）</option>`
    ).join('');
  }

  section.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">${Icon.learn}</div>
      <div class="empty-text">准备好学习新单词了吗？</div>
      <div class="empty-sub">
        每次学习 ${settings.batchSize} 个单词，当前拼写方式：${spellModeNames[settings.spellMode] || '部分挖空选词'}
      </div>
      <div class="empty-sub" style="margin-top: 0.5rem; font-size: 0.8rem; color: var(--text-muted);">
        学习流程：看单词和例句 → 自动拼写测试 → 拼错的单词重练 → 全部拼对后完成
      </div>

      <div class="card mt-2" style="max-width: 480px; width: 100%; margin-left: auto; margin-right: auto; text-align: left;">
        <div class="card-header">${Icon.learn} 词汇来源</div>
        <div class="range-radio-group">
          <label class="range-radio-label">
            <input type="radio" name="learn-source" value="random" checked>
            <span>随机生词</span>
          </label>
          <label class="range-radio-label">
            <input type="radio" name="learn-source" value="textbook">
            <span>按教材选择</span>
          </label>
          <label class="range-radio-label">
            <input type="radio" name="learn-source" value="learned">
            <span>已学单词复习</span>
          </label>
        </div>

        <div id="learn-textbook-select" style="display: none; margin-top: 1rem;">
          <div class="flex gap-1" style="flex-wrap: wrap;">
            <select id="learn-book-select" style="flex: 1; min-width: 120px;">
              ${bookOptions || '<option value="">无教材数据</option>'}
            </select>
            <select id="learn-unit-select" style="flex: 1; min-width: 120px;">
              <option value="all">全部单元</option>
            </select>
          </div>
        </div>
      </div>

      <button class="btn btn-primary btn-lg mt-2" onclick="startLearnFromSource()">
        开始学习
      </button>
    </div>
  `;

  // 初始化教材选择器
  if (textbookService && textbookService.isLoaded()) {
    const books = textbookService.getBooks();
    if (books.length > 0) {
      onLearnBookChange(books[0].book);
    }
  }

  // 监听词汇来源变化，控制教材选择区域显隐
  document.querySelectorAll('input[name="learn-source"]').forEach((radio) => {
    radio.onchange = () => {
      const textbookSelect = document.getElementById('learn-textbook-select');
      if (textbookSelect) {
        textbookSelect.style.display = radio.value === 'textbook' ? 'block' : 'none';
      }
    };
  });
  // 初始化动态生成的图标
  if (window.initIcons) initIcons();
}

/**
 * 开始新的学习批次
 */
function startNewBatch() {
  const settings = settingsStorage.getSettings();
  const totalCount = wordService.getTotalCount();

  if (totalCount === 0) {
    showToast('词库为空，请检查数据文件', 'error');
    return;
  }

  // 获取未学习的单词
  const progress = progressStorage.getAllProgress();
  const learnedIds = new Set(Object.keys(progress).map(Number));

  const unlearnedIds = [];
  for (let id = 1; id <= totalCount; id++) {
    if (!learnedIds.has(id)) {
      unlearnedIds.push(id);
    }
  }

  if (unlearnedIds.length === 0) {
    showToast('所有单词都已学习完毕，太棒了！', 'success');
    return;
  }

  // 随机取一批
  const batchIds = randomPick(unlearnedIds, Math.min(settings.batchSize, unlearnedIds.length));
  const batchWords = batchIds.map((id) => wordService.getWordById(id)).filter(Boolean);

  if (batchWords.length === 0) {
    showToast('无法获取单词数据', 'error');
    return;
  }

  // 初始化学习流程（分批学习）
  AppState.learnFlow = createLearnFlow(batchWords);

  renderLearnStudy();
}

/**
 * 学习页面教材书籍切换，更新单元下拉列表
 */
function onLearnBookChange(bookValue) {
  const book = parseInt(bookValue, 10);
  if (!book || !textbookService || !textbookService.isLoaded()) return;
  const units = textbookService.getUnits(book);
  const unitSelect = document.getElementById('learn-unit-select');
  if (!unitSelect) return;
  unitSelect.innerHTML = '<option value="all">全部单元</option>' +
    units.map((u) =>
      `<option value="${u.unit}">Unit ${u.unit}: ${u.title}（${u.wordCount}词）</option>`
    ).join('');
}

/**
 * 根据所选词汇来源开始学习
 * 支持：随机生词 / 按教材选择 / 已学单词复习
 */
function startLearnFromSource() {
  const sourceRadio = document.querySelector('input[name="learn-source"]:checked');
  const source = sourceRadio ? sourceRadio.value : 'random';
  const settings = settingsStorage.getSettings();

  let batchWords = [];

  if (source === 'random') {
    // 随机生词：复用原有批次逻辑（自动抽取未学习的单词）
    startNewBatch();
    return;
  } else if (source === 'textbook') {
    // 按教材选择
    if (!textbookService || !textbookService.isLoaded()) {
      showToast('教材数据未加载', 'error');
      return;
    }
    const bookSelect = document.getElementById('learn-book-select');
    const unitSelect = document.getElementById('learn-unit-select');
    const book = parseInt(bookSelect ? bookSelect.value : '0', 10);
    const unitValue = unitSelect ? unitSelect.value : 'all';
    if (!book) {
      showToast('请选择教材', 'error');
      return;
    }

    // 收集所选范围的单词（含词典数据）
    let wordItems = [];
    if (unitValue === 'all') {
      const units = textbookService.getUnits(book);
      for (const u of units) {
        wordItems.push(...textbookService.getUnitWordsWithDict(book, u.unit));
      }
    } else {
      wordItems = textbookService.getUnitWordsWithDict(book, parseInt(unitValue, 10));
    }

    // 过滤掉短语（短语无法进行拼写训练），并为每个单词补充 id（学习流程依赖 id 保存进度）
    let fakeId = 9000000;
    batchWords = wordItems
      .filter((item) => !item.isPhrase)
      .map((item) => {
        const entry = textbookService.matchWordToDictionary(item.word);
        return {
          id: entry && entry.id ? entry.id : fakeId++,
          word: entry && entry.word ? entry.word : item.word,
          phonetic: item.phonetic || (entry ? entry.phonetic : '') || '',
          translation: item.translation || (entry ? entry.translation : '') || '',
          pos: item.pos || '',
          collins: item.collins || 0,
          oxford: item.oxford || 0,
        };
      });

    // 选择“全部单元”时单词较多，随机抽取一批；指定单元则学习该单元的全部单词
    if (unitValue === 'all' && batchWords.length > settings.batchSize) {
      batchWords = randomPick(batchWords, settings.batchSize);
    }
  } else if (source === 'learned') {
    // 已学单词复习
    const progress = progressStorage.getAllProgress();
    const learnedIds = Object.keys(progress).map(Number);
    if (learnedIds.length === 0) {
      showToast('暂无已学单词，先去学习新词吧', 'info');
      return;
    }
    const batchIds = randomPick(learnedIds, Math.min(settings.batchSize, learnedIds.length));
    batchWords = batchIds.map((id) => wordService.getWordById(id)).filter(Boolean);
  }

  if (!batchWords || batchWords.length === 0) {
    showToast('没有可学习的单词', 'error');
    return;
  }

  // 检查是否有已保存的学习进度（仅教材学习模式）
  if (source === 'textbook') {
    const savedProgress = getLearnFlowProgress(batchWords);
    if (savedProgress) {
      // 有保存的进度，询问用户是否继续
      const masteredCount = (savedProgress.masteredWordIds || []).length;
      const totalCount = batchWords.length;
      showCustomConfirm({
        title: '继续学习',
        message: '检测到上次未完成的学习进度<br><br>' +
          `<small style="color:var(--text-muted);">` +
          `上次学到第 ${savedProgress.batchIndex + 1} 批，已掌握 ${masteredCount} / ${totalCount} 个单词<br>` +
          `保存时间：${new Date(savedProgress.savedAt).toLocaleString()}</small>`,
        confirmText: '继续学习',
        cancelText: '从头开始',
      }).then((confirmed) => {
        if (confirmed) {
          // 恢复上次进度
          AppState.learnFlow = restoreLearnFlowProgress(batchWords, savedProgress);
        } else {
          // 从头开始，清除旧进度
          clearLearnFlowProgress(batchWords);
          AppState.learnFlow = createLearnFlow(batchWords);
        }
        renderLearnStudy();
      });
      return;
    }
  }

  // 初始化学习流程（分批学习）
  AppState.learnFlow = createLearnFlow(batchWords);

  renderLearnStudy();
}

/**
 * 渲染学习卡片（单词 + 音标 + 释义 + AI例句）
 */
async function renderLearnStudy() {
  const section = document.getElementById('learn');
  if (!section || !AppState.learnFlow) return;

  const flow = AppState.learnFlow;
  const word = flow.currentBatch[flow.studyIndex];
  if (!word) {
    showToast('单词数据异常', 'error');
    return;
  }

  // 计算整体进度（跨所有批次）
  let studiedCount = 0;
  for (let i = 0; i < flow.batchIndex; i++) {
    studiedCount += (flow.batches[i] || []).length;
  }
  studiedCount += flow.studyIndex + 1;
  const progressPercent = Math.round((studiedCount / flow.words.length) * 100);
  const isLastInBatch = flow.studyIndex >= flow.currentBatch.length - 1;
  const isFirstInBatch = flow.studyIndex <= 0;
  const fromWordList = flow.fromWordList === true;
  const batchInfo = flow.batches.length > 1
    ? `批次 ${flow.batchIndex + 1}/${flow.batches.length} · `
    : '';

  section.innerHTML = `
    <div class="learn-phase-banner">
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        ${fromWordList ? `<button class="btn btn-ghost btn-sm" onclick="exitLearnFlow()" title="返回">${Icon.back} 返回</button>` : ''}
        <span class="phase-badge phase-study">${Icon.learn} 学习阶段</span>
      </div>
      <span class="text-muted" style="font-size: 0.85rem;">
        ${batchInfo}第 <strong>${flow.studyIndex + 1}</strong> / ${flow.currentBatch.length} 个
      </span>
    </div>

    <div class="progress-labeled" style="margin-bottom: 1rem;">
      <div class="progress-bar">
        <div class="progress-bar-fill" style="width: ${progressPercent}%"></div>
      </div>
      <span class="progress-text">${progressPercent}%</span>
    </div>

    <div class="word-card learn-mode">
      <div class="word-text">${word.word}</div>

      <div class="word-phonetic-wrap">
        ${word.phonetic ? `<div class="word-phonetic">${word.phonetic}</div>` : ''}
        <button class="phonetic-btn" onclick="speakWord('${word.word}')" title="点击发音">
          ${Icon.speak}
        </button>
      </div>

      ${word.pos ? `<span class="word-pos">${formatPos(word.pos)}</span>` : ''}

      <div class="word-translation">${word.translation || ''}</div>

      <div class="word-detail" id="learn-example-area">
        <div style="text-align: center; padding: 0.5rem;">
          <button class="btn btn-secondary btn-sm" onclick="generateExampleNow(${word.id})">
            ${Icon.learn} 生成例句
          </button>
        </div>
      </div>

      <div class="word-actions">
        <button class="btn btn-ghost btn-sm" onclick="speakWord('${word.word}')">
          ${Icon.speak} 发音
        </button>
        ${!isFirstInBatch ? `<button class="btn btn-secondary btn-sm" onclick="prevStudyWord()">
          ${Icon.back} 上一个
        </button>` : ''}
        <button class="btn btn-primary" onclick="nextStudyWord()">
          ${isLastInBatch ? Icon.spell + ' 开始拼写测试' : '下一个 ' + Icon.next}
        </button>
      </div>
    </div>
  `;

  // 标记该单词已学习
  flow.studiedWordIds[word.id] = true;

  speakWord(word.word);
  // 初始化动态生成的图标
  if (window.initIcons) initIcons();
}

/**
 * 手动生成例句（用户点击"生成例句"按钮后调用）
 */
async function generateExampleNow(wordId) {
  const flow = AppState.learnFlow;
  if (!flow) return;

  const word = flow.words.find((w) => w.id === wordId);
  if (!word) return;

  // 如果已有缓存的例句，直接显示
  if (flow.aiExamples[wordId]) {
    renderLearnExample(flow.aiExamples[wordId], word);
    updateExampleButton(wordId, true);
    return;
  }

  // 显示加载状态
  const area = document.getElementById('learn-example-area');
  if (area) {
    area.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        ${Icon.settings} 正在生成例句...
      </div>
    `;
  }

  if (!window.aiService || !aiService.isConfigured()) {
    renderLearnExample(null, word);
    return;
  }

  try {
    const result = await aiService.generateStyleExample(word.word, word.translation);
    if (result) {
      flow.aiExamples[wordId] = result;
    }
    renderLearnExample(result, word);
    updateExampleButton(wordId, !!result);
  } catch (e) {
    console.error('[Learn] AI例句生成失败:', e);
    renderLearnExample(null, word);
  }
}

/**
 * 更新例句区域的按钮（生成后变为"换个例句"）
 */
function updateExampleButton(wordId, hasExample) {
  // 按钮已经在renderLearnExample中渲染，这里不需要额外操作
}

/**
 * 异步加载AI例句（仅当已有缓存时显示）
 */
async function loadAIExampleForLearn(word) {
  const flow = AppState.learnFlow;
  if (!flow) return;

  // 仅当已有缓存时才显示
  if (flow.aiExamples[word.id]) {
    renderLearnExample(flow.aiExamples[word.id], word);
    return;
  }

  // 无缓存时不自动生成，显示"生成例句"按钮
  // renderLearnStudy已经渲染了按钮，不需要额外操作
}

/**
 * 手动重新生成例句（清除缓存后重新请求）
 */
async function regenerateExample(wordId) {
  const flow = AppState.learnFlow;
  if (!flow) return;

  const word = flow.words.find((w) => w.id === wordId);
  if (!word) return;

  // 清除该单词的缓存例句
  if (flow.aiExamples[wordId]) {
    delete flow.aiExamples[wordId];
  }

  // 也清除 IndexedDB 缓存
  try {
    if (window.cacheStorage) {
      await cacheStorage.clearCacheEntry(word.word);
    }
  } catch (e) {
    console.warn('[Learn] 清除缓存失败:', e);
  }

  // 显示加载状态
  const area = document.getElementById('learn-example-area');
  if (area) {
    area.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        ${Icon.settings} 正在生成新例句...
      </div>
    `;
  }

  if (!window.aiService || !aiService.isConfigured()) {
    renderLearnExample(null, word);
    return;
  }

  try {
    const result = await aiService.generateStyleExample(word.word, word.translation);
    if (result) {
      flow.aiExamples[wordId] = result;
    }
    renderLearnExample(result, word);
  } catch (e) {
    console.error('[Learn] AI例句生成失败:', e);
    renderLearnExample(null, word);
  }
}

/**
 * 渲染AI例句到卡片（目标单词加粗显示，无humor_type标签）
 */
function renderLearnExample(example, word) {
  const area = document.getElementById('learn-example-area');
  if (!area) return;

  const flow = AppState.learnFlow;
  if (!flow || flow.phase !== 'study') return;

  if (example && example.sentence) {
    // 将 **单词** 格式转为 <strong>单词</strong>
    let sentenceHtml = example.sentence;
    if (word && word.word) {
      // 替换 **目标词** 为加粗
      sentenceHtml = sentenceHtml.replace(/\*\*(.+?)\*\*/g, '<strong style="color: var(--accent);">$1</strong>');
      // 如果AI没有加星号，手动加粗目标词
      if (!sentenceHtml.includes('<strong')) {
        const lowerWord = word.word.toLowerCase();
        const regex = new RegExp(`(${word.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        sentenceHtml = sentenceHtml.replace(regex, '<strong style="color: var(--accent);">$1</strong>');
      }
    }

    // 同时清理翻译中的 ** 标记
    let translationHtml = example.translation || '';
    translationHtml = translationHtml.replace(/\*\*(.+?)\*\*/g, '$1');

    area.innerHTML = `
      <div class="example-sentence">${Icon.learn} ${sentenceHtml}</div>
      <div class="example-translation">${translationHtml}</div>
      <button class="btn btn-ghost btn-sm" onclick="regenerateExample(${word.id})" style="margin-top: 0.5rem; font-size: 0.8rem;">
        ${Icon.refresh} 换个例句
      </button>
    `;
  } else {
    area.innerHTML = `
      <div class="example-sentence text-muted" style="font-style: italic;">
        ${Icon.learn} 例句暂不可用（请确认本地代理服务已启动）
      </div>
      <button class="btn btn-secondary btn-sm" onclick="generateExampleNow(${word.id})" style="margin-top: 0.5rem;">
        ${Icon.refresh} 重试
      </button>
    `;
  }
}

/**
 * 退出学习流程
 */
function exitLearnFlow() {
  if (AppState.learnFlow && AppState.learnFlow.phase !== 'complete') {
    showCustomConfirm({
      title: '退出学习',
      message: '确定要退出当前学习吗？<br><br>' +
        '<small style="color:var(--text-muted);">已拼对的单词已自动保存进度，未完成拼写的单词不会计入已学会列表。下次进入此单元时可选择继续学习。</small>',
      confirmText: '退出并保存',
      cancelText: '继续学习',
    }).then((confirmed) => {
      if (confirmed) {
        saveLearnFlowProgress();
        AppState.learnFlow = null;
        navigate('wordlist');
      }
    });
    return;
  }
  AppState.learnFlow = null;
  navigate('wordlist');
}

/**
 * 保存当前学习进度到 localStorage
 * 下次进入同一单元时可选择继续
 */
function saveLearnFlowProgress() {
  const flow = AppState.learnFlow;
  if (!flow) return;

  // 构建进度数据（只保存必要的状态）
  const progress = {
    batchIndex: flow.batchIndex,
    studyIndex: flow.studyIndex,
    phase: flow.phase,
    masteredWordIds: flow.masteredWords.map(w => w.id).filter(Boolean),
    carriedWrongWords: flow.carriedWrongWords.map(w => w.word),
    savedAt: Date.now(),
  };

  // 生成进度 key：基于学习来源
  const key = getLearnFlowProgressKey(flow);
  if (key) {
    try {
      localStorage.setItem(key, JSON.stringify(progress));
      console.log('[LearnFlow] 学习进度已保存:', key);
    } catch (e) {
      console.warn('[LearnFlow] 保存进度失败:', e);
    }
  }
}

/**
 * 获取学习流程的进度存储 key
 * 基于学习来源（教材单元/随机/复习）生成唯一 key
 */
function getLearnFlowProgressKey(flow) {
  if (!flow) return null;
  // 复习模式或随机模式不保存进度
  if (flow.isReview) return null;
  // 从单词表进入的单个单词学习不保存
  if (flow.fromWordList) return null;
  // 教材学习：用所有单词的 ID 生成 key
  if (flow.words && flow.words.length > 0) {
    const firstId = flow.words[0].id || '';
    const lastId = flow.words[flow.words.length - 1].id || '';
    return 'learnflow_' + firstId + '_' + lastId + '_' + flow.words.length;
  }
  return null;
}

/**
 * 检查是否有已保存的学习进度
 * @param {Array} words - 本次学习的单词列表
 * @returns {object|null} 保存的进度数据
 */
function getLearnFlowProgress(words) {
  if (!words || words.length === 0) return null;
  const firstId = words[0].id || '';
  const lastId = words[words.length - 1].id || '';
  const key = 'learnflow_' + firstId + '_' + lastId + '_' + words.length;
  try {
    const data = localStorage.getItem(key);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.warn('[LearnFlow] 读取进度失败:', e);
  }
  return null;
}

/**
 * 清除已保存的学习进度
 * @param {Array} words - 本次学习的单词列表
 */
function clearLearnFlowProgress(words) {
  if (!words || words.length === 0) return;
  const firstId = words[0].id || '';
  const lastId = words[words.length - 1].id || '';
  const key = 'learnflow_' + firstId + '_' + lastId + '_' + words.length;
  try {
    localStorage.removeItem(key);
  } catch (e) { /* 忽略 */ }
}

/**
 * 恢复学习进度到 learnFlow
 * @param {Array} words - 完整的单词列表
 * @param {object} savedProgress - 保存的进度
 */
function restoreLearnFlowProgress(words, savedProgress) {
  const flow = createLearnFlow(words);
  flow.batchIndex = savedProgress.batchIndex || 0;
  flow.currentBatch = flow.batches[flow.batchIndex] || flow.batches[0];
  flow.studyIndex = savedProgress.studyIndex || 0;
  flow.phase = 'study'; // 恢复时总是从学习阶段开始（即使之前在拼写阶段）

  // 恢复已掌握的单词
  const masteredIds = new Set(savedProgress.masteredWordIds || []);
  flow.masteredWords = words.filter(w => masteredIds.has(w.id));

  // 恢复遗留错词
  const wrongWordTexts = new Set(savedProgress.carriedWrongWords || []);
  flow.carriedWrongWords = words.filter(w => wrongWordTexts.has(w.word));

  return flow;
}

/**
 * 学习阶段：下一个单词（当前批次最后一个时进入拼写测试）
 */
function nextStudyWord() {
  const flow = AppState.learnFlow;
  if (!flow) return;

  if (flow.studyIndex >= flow.currentBatch.length - 1) {
    startLearnSpell();
    return;
  }

  flow.studyIndex++;
  renderLearnStudy();
}

/**
 * 学习阶段：上一个单词（返回当前批次的前一个）
 */
function prevStudyWord() {
  const flow = AppState.learnFlow;
  if (!flow) return;

  if (flow.studyIndex <= 0) return;

  flow.studyIndex--;
  renderLearnStudy();
}

/**
 * 开始拼写测试阶段
 * 拼写队列 = 当前批次单词 + 上批遗留的错词（去重）
 */
function startLearnSpell() {
  const flow = AppState.learnFlow;
  if (!flow) return;

  flow.phase = 'spell';
  flow.round = (flow.round || 0) + 1;

  // 拼写队列：当前批次 + 上批错词（去重）
  const spellQueue = [...flow.currentBatch];
  for (const w of flow.carriedWrongWords) {
    if (!spellQueue.find(s => s.word === w.word)) {
      spellQueue.push(w);
    }
  }
  flow.spellQueue = spellQueue;

  const settings = settingsStorage.getSettings();
  const mode = settings.spellMode || 'partial';

  SpellModule.start(
    spellQueue,
    mode,
    {
      learnMode: true,
      targetSection: 'learn',
      onComplete: onLearnSpellComplete,
    }
  );
}

/**
 * 拼写测试完成回调（分批学习核心逻辑）
 * - 当前批次拼对的单词 → 标记已掌握
 * - 当前批次拼错的单词 → 带入下一批拼写
 * - 还有下一批 → 进入下一批学习
 * - 没有下一批但还有错词 → 继续拼写错词
 * - 全部拼对 → 完成学习
 */
function onLearnSpellComplete(result) {
  const flow = AppState.learnFlow;
  if (!flow) return;

  const { wrongWords } = result;
  const wrongSet = new Set((wrongWords || []).map(w => w.word));

  // 当前批次中拼对的单词 → 标记已掌握
  const newlyMastered = flow.currentBatch.filter(w => !wrongSet.has(w.word));
  for (const word of newlyMastered) {
    if (word.id) {
      progressStorage.saveProgress(word.id, 'mastered', word.word);
    }
    if (!flow.masteredWords.find(m => m.word === word.word)) {
      flow.masteredWords.push(word);
    }
  }

  // 上批遗留的错词中，这次拼对的 → 也标记已掌握
  const carriedMastered = flow.carriedWrongWords.filter(w => !wrongSet.has(w.word));
  for (const word of carriedMastered) {
    if (word.id) {
      progressStorage.saveProgress(word.id, 'mastered', word.word);
    }
    if (!flow.masteredWords.find(m => m.word === word.word)) {
      flow.masteredWords.push(word);
    }
  }

  // 收集所有仍然拼错的单词（当前批次 + 遗留错词）
  const currentBatchWrong = flow.currentBatch.filter(w => wrongSet.has(w.word));
  const carriedStillWrong = flow.carriedWrongWords.filter(w => wrongSet.has(w.word));
  const allWrong = [...currentBatchWrong, ...carriedStillWrong];

  // 检查是否还有下一批
  const hasNextBatch = flow.batchIndex < flow.batches.length - 1;

  if (hasNextBatch) {
    // 进入下一批学习，所有错词带入下批拼写
    flow.carriedWrongWords = allWrong;
    flow.batchIndex++;
    flow.currentBatch = flow.batches[flow.batchIndex];
    flow.studyIndex = 0;
    flow.phase = 'study';
    showToast(
      allWrong.length > 0
        ? `本批完成！${allWrong.length} 个错词将带入下批复习`
        : '本批全部拼对！继续下一批',
      allWrong.length > 0 ? 'info' : 'success'
    );
    setTimeout(() => renderLearnStudy(), 600);
  } else {
    // 没有下一批了
    if (allWrong.length > 0) {
      // 还有错词，继续拼写
      flow.carriedWrongWords = [];
      flow.currentBatch = allWrong;
      flow.phase = 'spell';
      showToast(`还有 ${allWrong.length} 个单词需要再拼一次`, 'info');
      setTimeout(() => startLearnSpell(), 800);
    } else {
      // 全部完成
      completeLearnBatch();
    }
  }
}

/**
 * 完成学习批次（单词已在拼写完成时逐个标记为已掌握）
 */
function completeLearnBatch() {
  const flow = AppState.learnFlow;
  if (!flow) return;

  // 学习完成，清除保存的进度
  clearLearnFlowProgress(flow.words);

  flow.phase = 'complete';
  renderLearnComplete();
}

/**
 * 渲染学习完成界面
 */
function renderLearnComplete() {
  const section = document.getElementById('learn');
  if (!section || !AppState.learnFlow) return;

  const flow = AppState.learnFlow;
  const masteredCount = flow.masteredWords.length;
  const totalCount = flow.words.length;
  const rounds = flow.round || 1;

  section.innerHTML = `
    <div class="batch-complete">
      <div class="complete-icon">${Icon.trophy}</div>
      <div class="complete-title">学习完成！</div>
      <div class="text-muted" style="margin-bottom: 1rem;">
        共掌握 ${masteredCount} / ${totalCount} 个单词${rounds > 1 ? `（经过 ${rounds} 轮拼写）` : ''}
      </div>

      <div class="batch-stats">
        <div class="stat-item mastered">
          <div class="stat-number">${masteredCount}</div>
          <div class="stat-label">已掌握</div>
        </div>
        <div class="stat-item total">
          <div class="stat-number">${totalCount}</div>
          <div class="stat-label">总单词数</div>
        </div>
        <div class="stat-item learning">
          <div class="stat-number">${rounds}</div>
          <div class="stat-label">拼写轮次</div>
        </div>
      </div>

      <div class="batch-actions">
        <button class="btn btn-primary" onclick="AppState.learnFlow=null; startNewBatch()">继续学习下一批</button>
        <button class="btn btn-primary" onclick="enterSpellFromLearn()">进入拼写训练</button>
        <button class="btn btn-ghost" onclick="AppState.learnFlow=null; navigate('home')">返回首页</button>
      </div>
    </div>
  `;

  showToast(`恭喜！${masteredCount} 个单词全部掌握！`, 'success');
  // 初始化动态生成的图标
  if (window.initIcons) initIcons();
}

/**
 * 学习完成后进入拼写训练（用刚学完的单词启动）
 */
function enterSpellFromLearn() {
  const flow = AppState.learnFlow;
  const learnedWords = flow && flow.words ? flow.words : [];
  const settings = settingsStorage.getSettings();
  const mode = settings.spellMode || 'partial';

  // 先清除学习流程，避免 navigate 触发“离开学习”确认弹窗
  AppState.learnFlow = null;

  if (learnedWords.length === 0) {
    navigate('spell');
    return;
  }

  // 跳转到拼写板块
  navigate('spell');
  // 用刚学完的单词启动拼写训练
  SpellModule.start(learnedWords, mode);
}

/**
 * 从单词表点击单词开始学习单个单词
 */
function startSingleWordLearn(wordObj) {
  if (!wordObj) return;
  AppState.learnFlow = createLearnFlow([wordObj], { fromWordList: true });
  navigate('learn');
}

/**
 * 朗读单词（改进版：选择高质量语音引擎，优化清晰度）
 */
/**
 * 语音朗读缓存：已加载的语音列表
 */
let _cachedVoices = null;

/**
 * 初始化语音引擎（页面加载时调用）
 * 某些浏览器需要用户交互后才能加载语音列表
 */
function initSpeechEngine() {
  if (!('speechSynthesis' in window)) return;

  // 尝试获取语音列表
  const loadVoices = () => {
    const voices = window.speechSynthesis.getVoices();
    if (voices && voices.length > 0) {
      _cachedVoices = voices;
    }
  };
  loadVoices();

  // voices 可能异步加载，监听变化
  if (typeof speechSynthesis.onvoiceschanged !== 'undefined') {
    speechSynthesis.onvoiceschanged = loadVoices;
  }

  // 某些浏览器需要轮询（如 Safari）
  let attempts = 0;
  const pollVoices = setInterval(() => {
    attempts++;
    if (_cachedVoices && _cachedVoices.length > 0) {
      clearInterval(pollVoices);
    } else {
      loadVoices();
    }
    if (attempts > 10) clearInterval(pollVoices);
  }, 200);
}

/**
 * 朗读单词（兼容多浏览器）
 * 使用 Web Speech API，带完善的错误处理和重试机制
 * @param {string} word - 要朗读的单词
 */
function speakWord(word) {
  if (!word) return;

  // 检测浏览器是否支持语音合成
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    console.warn('[speakWord] 浏览器不支持语音合成');
    showToast('当前浏览器不支持语音朗读，建议使用 Chrome 或 Edge 浏览器', 'error');
    return;
  }

  try {
    // 取消之前的朗读（避免排队堆积）
    window.speechSynthesis.cancel();

    // 短暂延迟后开始新的朗读（部分浏览器需要这个间隔）
    setTimeout(() => {
      const settings = settingsStorage.getSettings();
      const utterance = new SpeechSynthesisUtterance(word);
      utterance.lang = 'en-US';
      utterance.rate = settings.voiceRate || 0.85;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      // 获取语音列表（优先使用缓存，避免每次都调用 getVoices）
      let voices = _cachedVoices;
      if (!voices || voices.length === 0) {
        voices = window.speechSynthesis.getVoices();
        if (voices && voices.length > 0) _cachedVoices = voices;
      }

      // 选择最佳英语语音引擎
      if (voices && voices.length > 0) {
        const preferred =
          voices.find((v) => v.name && v.name.includes('Google') && v.lang === 'en-US') ||
          voices.find((v) => v.name && v.name.includes('Microsoft') && v.lang === 'en-US') ||
          voices.find((v) => v.name && v.name.includes('Samantha')) ||
          voices.find((v) => v.lang === 'en-US') ||
          voices.find((v) => v.lang && v.lang.startsWith('en'));
        if (preferred) {
          utterance.voice = preferred;
        }
      }

      // 错误处理：朗读失败时提示
      utterance.onerror = (event) => {
        console.warn('[speakWord] 朗读失败:', event.error);
        // 某些错误（如 interrupted）不需要提示用户
        if (event.error && event.error !== 'interrupted' && event.error !== 'canceled') {
          console.warn('[speakWord] 语音引擎错误:', event.error);
        }
      };

      // 确保 speechSynthesis 处于运行状态
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }

      window.speechSynthesis.speak(utterance);

      // Chrome bug 修复：长时间不说话后引擎会"休眠"，需要 resume 唤醒
      window.speechSynthesis.resume();
    }, 50);
  } catch (e) {
    console.error('[speakWord] 异常:', e);
  }
}

/**
 * 获取状态标签文本
 */
function getStatusLabel(status) {
  const labels = {
    learning: '学习中',
    mastered: '已掌握',
    review: '待复习',
  };
  return labels[status] || status;
}

/* ===========================
   拼写训练页面（模式选择 + 词汇范围选择）
   =========================== */
async function renderSpell() {
  if (SpellModule.currentWord) return;

  const section = document.getElementById('spell');
  if (!section) return;

  if (textbookService && !textbookService.isLoaded()) {
    try {
      await textbookService.load();
    } catch (e) {
      console.warn('[App] 教材数据加载失败，拼写训练将不支持教材选择');
    }
  }

  const settings = settingsStorage.getSettings();
  const currentMode = settings.spellMode || 'partial';
  const spellModeNames = {
    partial: '部分挖空选词',
    full: '完整音节选词',
    manual: '手动拼写',
  };

  let bookOptions = '';
  if (textbookService && textbookService.isLoaded()) {
    const books = textbookService.getBooks();
    bookOptions = books.map((b) =>
      `<option value="${b.book}">${b.name}（${b.unitCount}单元）</option>`
    ).join('');
  }

  section.innerHTML = `
    <div class="spell-setup">
      <div class="mb-3">
        <h2 style="font-size: 1.5rem; margin-bottom: 0.25rem;">${Icon.spell} 拼写训练</h2>
        <p class="text-muted" style="font-size: 0.9rem;">
          当前拼写方式：<strong>${spellModeNames[currentMode]}</strong>
          <button class="btn btn-ghost btn-sm" onclick="toggleSettings(true)" style="margin-left: 0.5rem; font-size: 0.8rem;">去设置修改</button>
        </p>
      </div>

      <div class="card mb-2">
        <div class="card-header">${Icon.learn} 选择词汇范围</div>
        <div class="range-radio-group">
          <label class="range-radio-label">
            <input type="radio" name="spell-range" value="random" checked onchange="onSpellRangeChange('random')">
            <span>随机抽取</span>
          </label>
          <label class="range-radio-label">
            <input type="radio" name="spell-range" value="textbook" onchange="onSpellRangeChange('textbook')">
            <span>按教材选择</span>
          </label>
          <label class="range-radio-label">
            <input type="radio" name="spell-range" value="learned" onchange="onSpellRangeChange('learned')">
            <span>已学单词复习</span>
          </label>
        </div>

        <div id="spell-textbook-select" style="display: none; margin-top: 1rem;">
          <div class="flex gap-1" style="flex-wrap: wrap; align-items: center;">
            <select id="spell-book-select" onchange="onSpellBookChange(this.value)" style="flex: 1; min-width: 120px;">
              ${bookOptions || '<option value="">无教材数据</option>'}
            </select>
            <select id="spell-unit-select" style="flex: 1; min-width: 120px;">
              <option value="all">全部单元</option>
            </select>
          </div>
          <p class="text-muted mt-1" style="font-size: 0.8rem;" id="spell-textbook-info"></p>
        </div>
      </div>

      <div style="text-align: center; margin-top: 1.5rem;">
        <button class="btn btn-primary btn-lg" onclick="startSpellTrainingV2()">
          开始训练
        </button>
      </div>
    </div>
  `;

  if (textbookService && textbookService.isLoaded()) {
    const books = textbookService.getBooks();
    if (books.length > 0) {
      onSpellBookChange(books[0].book);
    }
  }
  // 初始化动态生成的图标
  if (window.initIcons) initIcons();
}

/**
 * 拼写模式切换处理
 */
function onSpellModeChange(mode) {
  // 模式选择已移至设置面板，此函数保留兼容性
  updateSpellMode(mode);
}

/**
 * 拼写范围切换处理
 */
function onSpellRangeChange(range) {
  const textbookSelect = document.getElementById('spell-textbook-select');
  if (textbookSelect) {
    textbookSelect.style.display = range === 'textbook' ? 'block' : 'none';
  }
}

/**
 * 拼写教材书籍切换处理，更新单元列表
 */
function onSpellBookChange(bookValue) {
  const book = parseInt(bookValue, 10);
  if (!book || !textbookService || !textbookService.isLoaded()) return;

  const units = textbookService.getUnits(book);
  const unitSelect = document.getElementById('spell-unit-select');
  if (!unitSelect) return;

  unitSelect.innerHTML = '<option value="all">全部单元</option>' +
    units.map((u) => 
      `<option value="${u.unit}">Unit ${u.unit}: ${u.title}（${u.wordCount}词）</option>`
    ).join('');

  const info = document.getElementById('spell-textbook-info');
  if (info) {
    const totalWords = units.reduce((sum, u) => sum + u.wordCount, 0);
    info.textContent = `共 ${units.length} 个单元，${totalWords} 个单词`;
  }
}

/**
 * 开始拼写训练（使用设置中的拼写模式）
 */
async function startSpellTrainingV2() {
  // 首次使用拼写训练：先引导用户选择拼写方式
  if (!localStorage.getItem('spellSettingsShown')) {
    // 标记为已展示，避免重复弹窗
    localStorage.setItem('spellSettingsShown', '1');
    // 打开设置面板
    toggleSettings(true);
    // 提示用户先选择拼写方式
    showToast('首次使用拼写训练，请先选择适合你的拼写方式', 'info');
    // 滚动到拼写模式选择区域
    setTimeout(() => {
      const spellModeSelect = document.getElementById('setting-spell-mode');
      if (spellModeSelect) {
        // 选中其所在的设置分组，滚动到可视区域
        const group = spellModeSelect.closest('.setting-group');
        const target = group || spellModeSelect;
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 300);
    // 监听设置面板关闭：用户关闭后自动开始拼写训练
    const panel = document.getElementById('settings-panel');
    if (panel) {
      const observer = new MutationObserver(() => {
        if (!panel.classList.contains('open')) {
          observer.disconnect();
          // 用户关闭设置面板后，再开始拼写训练
          startSpellTrainingV2();
        }
      });
      observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
    }
    return;
  }

  const settings = settingsStorage.getSettings();
  const mode = settings.spellMode || 'partial';

  // 读取选中的范围
  const rangeRadio = document.querySelector('input[name="spell-range"]:checked');
  const range = rangeRadio ? rangeRadio.value : 'random';

  let words = [];

  if (range === 'random') {
    const totalCount = wordService.getTotalCount();
    if (totalCount === 0) {
      showToast('词库为空', 'error');
      return;
    }
    const allIds = Array.from({ length: totalCount }, (_, i) => i + 1);
    const batchIds = randomPick(allIds, settings.batchSize);
    words = batchIds.map((id) => wordService.getWordById(id)).filter(Boolean);
  } else if (range === 'textbook') {
    if (!textbookService || !textbookService.isLoaded()) {
      showToast('教材数据未加载', 'error');
      return;
    }
    const bookSelect = document.getElementById('spell-book-select');
    const unitSelect = document.getElementById('spell-unit-select');
    const book = parseInt(bookSelect ? bookSelect.value : '0', 10);
    const unitValue = unitSelect ? unitSelect.value : 'all';

    if (!book) {
      showToast('请选择教材', 'error');
      return;
    }

    if (unitValue === 'all') {
      const units = textbookService.getUnits(book);
      let allMatched = [];
      for (const u of units) {
        allMatched.push(...textbookService.getMatchedUnitWords(book, u.unit));
      }
      words = randomPick(allMatched, Math.min(settings.batchSize, allMatched.length));
    } else {
      const unit = parseInt(unitValue, 10);
      const matched = textbookService.getMatchedUnitWords(book, unit);
      words = randomPick(matched, Math.min(settings.batchSize, matched.length));
    }

    if (words.length === 0) {
      showToast('该单元没有可匹配词库的单词', 'error');
      return;
    }
  } else if (range === 'learned') {
    const progress = progressStorage.getAllProgress();
    const learnedIds = Object.keys(progress)
      .filter((id) => {
        const item = progress[id];
        return item.status === 'review' || item.status === 'learning' || item.status === 'mastered';
      })
      .map(Number);

    if (learnedIds.length === 0) {
      showToast('暂无已学单词，快去学习新词吧', 'info');
      return;
    }

    const batchIds = randomPick(learnedIds, Math.min(settings.batchSize, learnedIds.length));
    words = batchIds.map((id) => wordService.getWordById(id)).filter(Boolean);
  }

  if (words.length === 0) {
    showToast('没有可训练的单词', 'error');
    return;
  }

  SpellModule.start(words, mode);
}

/**
 * 开始音节拆分拼写训练（兼容旧版入口）
 */
function startSpellTraining() {
  startSpellTrainingV2();
}

/* ===========================
   单词表页面（教材词汇表）
   =========================== */

// 单词表当前选中的书籍（模块级状态）
let _wordlistCurrentBook = 1;

/**
 * 渲染教材单词表页面
 * 按书籍 -> 单元分组，每个单元可展开/折叠
 */
async function renderWordList() {
  const section = document.getElementById('wordlist');
  if (!section) return;

  // 确保教材数据已加载
  if (!textbookService || !textbookService.isLoaded()) {
    try {
      await textbookService.load();
    } catch (e) {
      section.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">${Icon.alert}</div>
          <div class="empty-text">教材数据加载失败</div>
          <div class="empty-sub">请检查 data/textbook-units.json 文件是否存在</div>
        </div>
      `;
      return;
    }
  }

  const books = textbookService.getBooks();
  if (books.length === 0) {
    section.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${Icon.learn}</div>
        <div class="empty-text">暂无教材数据</div>
      </div>
    `;
    return;
  }

  // 书籍选择器
  const bookTabs = books.map((b) => `
    <button class="book-tab ${b.book === _wordlistCurrentBook ? 'active' : ''}"
      data-book="${b.book}"
      onclick="switchWordlistBook(${b.book})">
      ${b.name}
    </button>
  `).join('');

  section.innerHTML = `
    <div class="mb-3">
      <h2 style="font-size: 1.5rem; margin-bottom: 0.25rem;">${Icon.wordlist} 教材词汇表</h2>
      <p class="text-muted" style="font-size: 0.9rem;">点击单元展开，点击单词可学习，${Icon.speak} 图标可朗读</p>
    </div>

    <div class="book-tabs-container">
      ${bookTabs}
    </div>

    <div id="wordlist-units">
      ${renderWordlistUnits(_wordlistCurrentBook)}
    </div>
  `;
  // 初始化动态生成的图标
  if (window.initIcons) initIcons();
}

/**
 * 渲染指定书籍的单元列表（使用教材词典数据，标记已学单词）
 */
function renderWordlistUnits(book) {
  const units = textbookService.getUnits(book);
  if (units.length === 0) return '<p class="text-muted">无单元数据</p>';

  const progress = progressStorage.getAllProgress();

  return units.map((u, index) => {
    // 使用 getUnitWordsWithDict 获取含词典数据的单词列表
    const wordItems = textbookService.getUnitWordsWithDict(book, u.unit);
    const matchedCount = wordItems.filter((w) => w.translation).length;

    // 检查该单元所有可学习单词是否都已学完（用于显示完成标记）
    // 使用 getUnitWords 获取原始单词列表，过滤掉短语（短语无法学习，不参与完成判断）
    const unitWords = textbookService.getUnitWords(book, u.unit);
    const learnableWords = unitWords.filter(
      (w) => !w.includes(' ') && !w.includes('...') && !w.includes('/')
    );
    let unitCompleted = learnableWords.length > 0;
    for (const w of learnableWords) {
      if (!progressStorage.getWordStatus(w)) {
        unitCompleted = false;
        break;
      }
    }

    return `
      <div class="card mb-1 wordlist-unit-card">
        <div class="wordlist-unit-header" onclick="toggleUnitExpand(this)">
          <div class="wordlist-unit-title">
            <span class="wordlist-unit-num">Unit ${u.unit}</span>
            <span class="wordlist-unit-name">${u.title}</span>
            ${unitCompleted ? `<span class="wordlist-unit-complete" title="本单元已全部学完" style="margin-left: 0.35rem; color: var(--warning, #f5a623);">${Icon.trophy}</span>` : ''}
          </div>
          <div class="wordlist-unit-meta">
            <span class="text-muted" style="font-size: 0.8rem;">${u.wordCount}词（${matchedCount}个有释义）</span>
            <span class="wordlist-toggle">&#x25B6;</span>
          </div>
        </div>
        <div class="wordlist-unit-body" style="display: ${index === 0 ? 'block' : 'none'};">
          ${wordItems.map((item) => {
            // 检查该单词是否已学
            const lowerWord = item.word.toLowerCase();
            const learnedEntry = Object.values(progress).find((p) => {
              const w = wordService.getWordById(parseInt(Object.keys(progress).find(k => progress[k] === p), 10));
              return w && w.word && w.word.toLowerCase() === lowerWord;
            });
            const isLearned = !!learnedEntry;
            const learnedStatus = learnedEntry ? learnedEntry.status : null;

            // 转义单词中的引号
            const safeWord = item.word.replace(/'/g, "\\'");

            if (item.isPhrase) {
              return `
                <div class="wordlist-word-item wordlist-word-phrase">
                  <div class="wordlist-word">${item.word}</div>
                  <div class="wordlist-translation text-muted" style="font-size: 0.8rem; font-style: italic;">${item.translation || '短语'}</div>
                </div>
              `;
            }

            return `
              <div class="wordlist-word-item ${isLearned ? 'word-learned' : ''} ${(item.collins <= 1 && item.oxford === 0 && !item.isPhrase) ? 'word-obscure' : ''}"
                onclick="learnWordFromList('${safeWord}')"
                style="cursor: pointer;">
                <div class="wordlist-word">
                  ${item.word}${(item.collins >= 3 || item.oxford >= 1) ? `<span class="wordlist-star">${Icon.star}</span>` : ''}
                  ${isLearned ? `<span class="word-learned-badge ${learnedStatus}">${getStatusLabel(learnedStatus)}</span>` : ''}
                </div>
                ${item.phonetic ? `<div class="wordlist-phonetic">${item.phonetic}</div>` : ''}
                <button class="wordlist-speak-btn" onclick="event.stopPropagation(); speakWord('${safeWord}')" title="朗读">${Icon.speak}</button>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 从单词表点击单词开始学习
 */
function learnWordFromList(word) {
  if (!word) return;

  // 从教材词典中查找完整词条
  const entry = textbookService.matchWordToDictionary(word);
  if (entry) {
    startSingleWordLearn(entry);
    return;
  }

  // 降级：从 gk3500 查找
  if (wordService && wordService.isLoaded()) {
    const dict = wordService._dictionary;
    if (dict) {
      const lower = word.toLowerCase();
      const found = dict.find((d) => d.word && d.word.toLowerCase() === lower);
      if (found) {
        startSingleWordLearn(found);
        return;
      }
    }
  }

  // 最终降级：构造简单词条
  startSingleWordLearn({
    id: 0,
    word: word,
    phonetic: '',
    translation: '',
    pos: '',
  });
}

/**
 * 切换单词表书籍
 */
function switchWordlistBook(book) {
  _wordlistCurrentBook = book;
  // 更新书籍标签高亮
  document.querySelectorAll('.book-tab').forEach((tab) => {
    if (parseInt(tab.dataset.book, 10) === book) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });
  // 重新渲染单元列表
  const unitsContainer = document.getElementById('wordlist-units');
  if (unitsContainer) {
    unitsContainer.innerHTML = renderWordlistUnits(book);
  }
}

/**
 * 展开/折叠单元
 */
function toggleUnitExpand(headerEl) {
  const body = headerEl.nextElementSibling;
  const toggle = headerEl.querySelector('.wordlist-toggle');
  if (body) {
    if (body.style.display === 'none') {
      body.style.display = 'block';
      if (toggle) toggle.innerHTML = '&#x25BC;';
    } else {
      body.style.display = 'none';
      if (toggle) toggle.innerHTML = '&#x25B6;';
    }
  }
}

/* ===========================
   已学单词页面
   =========================== */

/**
 * 渲染已学单词页面
 * 按学习状态分组，支持搜索
 */
function renderLearnedWords() {
  const section = document.getElementById('learned');
  if (!section) return;

  const progress = progressStorage.getAllProgress();
  const progressEntries = Object.entries(progress);

  if (progressEntries.length === 0) {
    section.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${Icon.learn}</div>
        <div class="empty-text">还没有已学单词</div>
        <div class="empty-sub">去学习页面开始背单词吧</div>
        <button class="btn btn-primary btn-lg mt-2" onclick="navigate('learn')">
          去学习
        </button>
      </div>
    `;
    return;
  }

  // 统计各状态数量
  const stats = { mastered: 0, learning: 0, review: 0 };
  for (const [, info] of progressEntries) {
    if (stats[info.status] !== undefined) stats[info.status]++;
  }

  // 按教材位置分组
  const wordsByTextbook = {}; // { "bookName|unit": [{ word, status, updatedAt }] }
  const ungroupedWords = [];

  for (const [id, info] of progressEntries) {
    const wordId = parseInt(id, 10);
    const word = getWordDataGlobal(wordId, info.word);
    if (!word) continue;

    const wordData = {
      word: word,
      status: info.status,
      updatedAt: info.updatedAt,
      wordId: wordId,
    };

    let location = null;
    if (textbookService && textbookService.isLoaded()) {
      location = textbookService.findWordLocation(word.word);
    }

    if (location) {
      const key = `${location.bookName}|Unit ${location.unit}|${location.book}|${location.unit}`;
      if (!wordsByTextbook[key]) {
        wordsByTextbook[key] = [];
      }
      wordsByTextbook[key].push(wordData);
    } else {
      ungroupedWords.push(wordData);
    }
  }

  // 按教材顺序排序（按 book, unit 排序）
  const sortedKeys = Object.keys(wordsByTextbook).sort((a, b) => {
    const [_, __, bookA, unitA] = a.split('|');
    const [___, ____, bookB, unitB] = b.split('|');
    const bookDiff = parseInt(bookA) - parseInt(bookB);
    if (bookDiff !== 0) return bookDiff;
    return parseInt(unitA) - parseInt(unitB);
  });

  // 存储到全局供搜索使用
  window._learnedWordsData = { wordsByTextbook, sortedKeys, ungroupedWords, stats, total: progressEntries.length };

  section.innerHTML = `
    <div class="mb-3">
      <h2 style="font-size: 1.5rem; margin-bottom: 0.25rem;">${Icon.learned} 已学单词</h2>
      <p class="text-muted" style="font-size: 0.9rem;">
        共 ${progressEntries.length} 个单词
        | ${Icon.check} 已掌握 ${stats.mastered}
        | ${Icon.learn} 学习中 ${stats.learning}
        | ${Icon.refresh} 待复习 ${stats.review}
      </p>
    </div>

    <div class="search-box">
      <span class="search-icon">${Icon.search}</span>
      <input type="text" id="learned-search-input" placeholder="搜索单词或释义..."
        oninput="filterLearnedWords(this.value)">
    </div>

    <div id="learned-words-container">
      ${renderLearnedWordsList('')}
    </div>
  `;
  // 初始化动态生成的图标
  if (window.initIcons) initIcons();
}

/**
 * 渲染已学单词列表（按教材分组）
 */
function renderLearnedWordsList(query) {
  const data = window._learnedWordsData;
  if (!data) return '';

  const lowerQuery = query.toLowerCase().trim();
  const filterFn = (item) => {
    if (!lowerQuery) return true;
    const word = item.word.word.toLowerCase();
    const translation = (item.word.translation || '').toLowerCase();
    return word.includes(lowerQuery) || translation.includes(lowerQuery);
  };

  const statusIcons = {
    mastered: Icon.check,
    learning: Icon.learn,
    review: Icon.refresh,
  };

  const statusColors = {
    mastered: 'var(--accent)',
    learning: 'var(--warning)',
    review: 'var(--info)',
  };

  let html = '';

  // 按教材分组渲染
  for (const key of data.sortedKeys) {
    const [, unitLabel, bookVal, unitVal] = key.split('|');
    const words = data.wordsByTextbook[key];
    const filtered = words.filter(filterFn);
    if (filtered.length === 0) continue;

    const bookName = key.split('|')[0];
    html += `
      <div class="card mb-2">
        <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
          <span>${Icon.wordlist} ${bookName} - ${unitLabel}</span>
          <span class="text-muted" style="font-size: 0.85rem; font-weight: normal;">
            ${filtered.length} 词
            <button class="btn btn-ghost btn-sm" style="font-size: 0.75rem; margin-left: 0.5rem; padding: 0.15rem 0.4rem;"
              onclick="navigateToWordlistUnit(${bookVal}, ${unitVal})">跳转</button>
          </span>
        </div>
        <div class="learned-words-grid">
          ${filtered.map((item) => {
            const w = item.word;
            return `
              <div class="learned-word-item" onclick="speakWord('${w.word}')">
                <div class="learned-word-main">
                  <span class="learned-word-text">${w.word}</span>
                  <span class="learned-status-badge" style="color: ${statusColors[item.status]};" title="${getStatusLabel(item.status)}">
                    ${statusIcons[item.status]}
                  </span>
                </div>
                ${w.phonetic ? `<div class="learned-word-phonetic">${w.phonetic}</div>` : ''}
                <div class="learned-word-translation">${w.translation || ''}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // 未分组的单词
  const ungroupedFiltered = data.ungroupedWords.filter(filterFn);
  if (ungroupedFiltered.length > 0) {
    html += `
      <div class="card mb-2">
        <div class="card-header">${Icon.learned} 其他（非教材词汇）</div>
        <div class="learned-words-grid">
          ${ungroupedFiltered.map((item) => {
            const w = item.word;
            return `
              <div class="learned-word-item" onclick="speakWord('${w.word}')">
                <div class="learned-word-main">
                  <span class="learned-word-text">${w.word}</span>
                  <span class="learned-status-badge" style="color: ${statusColors[item.status]};" title="${getStatusLabel(item.status)}">
                    ${statusIcons[item.status]}
                  </span>
                </div>
                ${w.phonetic ? `<div class="learned-word-phonetic">${w.phonetic}</div>` : ''}
                <div class="learned-word-translation">${w.translation || ''}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  if (!html) {
    html = `
      <div class="empty-state">
        <div class="empty-icon">${Icon.search}</div>
        <div class="empty-text">没有匹配 "${query}" 的单词</div>
      </div>
    `;
  }

  return html;
}

/**
 * 过滤已学单词（搜索）
 */
function filterLearnedWords(query) {
  const container = document.getElementById('learned-words-container');
  if (container) {
    container.innerHTML = renderLearnedWordsList(query);
  }
}

/**
 * 跳转到单词表的指定单元
 */
function navigateToWordlistUnit(book, unit) {
  _wordlistCurrentBook = book;
  navigate('wordlist');
  // 延迟后展开对应单元
  setTimeout(() => {
    const headers = document.querySelectorAll('.wordlist-unit-header');
    headers.forEach((header) => {
      const title = header.querySelector('.wordlist-unit-num');
      if (title && title.textContent === `Unit ${unit}`) {
        const body = header.nextElementSibling;
        if (body && body.style.display === 'none') {
          toggleUnitExpand(header);
        }
        // 滚动到该单元
        header.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }, 200);
}

/* ===========================
   快速查词页面
   =========================== */

/**
 * 渲染快速查词页面
 */
function renderSearch() {
  const section = document.getElementById('search');
  if (!section) return;

  section.innerHTML = `
    <div class="mb-3">
      <h2 style="font-size: 1.5rem; margin-bottom: 0.25rem;">${Icon.search} 快速查词</h2>
      <p class="text-muted" style="font-size: 0.9rem;">输入单词或释义，实时搜索词库</p>
    </div>

    <!-- 搜索框 -->
    <div class="search-box">
      <span class="search-icon">${Icon.search}</span>
      <input type="text" id="search-input" placeholder="输入英文单词或中文释义..."
        autocomplete="off" autofocus
        oninput="performSearch(this.value)">
    </div>

    <!-- 搜索结果 -->
    <div id="search-results">
      <div class="empty-state">
        <div class="empty-icon">${Icon.spell}</div>
        <div class="empty-text">开始输入以搜索单词</div>
        <div class="empty-sub">支持英文前缀搜索和中文释义搜索</div>
      </div>
    </div>
  `;

  // 自动聚焦
  setTimeout(() => {
    const input = document.getElementById('search-input');
    if (input) input.focus();
  }, 100);
  // 初始化动态生成的图标
  if (window.initIcons) initIcons();
}

/**
 * 执行搜索单词
 */
function performSearch(query) {
  const resultsContainer = document.getElementById('search-results');
  if (!resultsContainer) return;

  const trimmed = query.trim();
  if (!trimmed) {
    resultsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${Icon.spell}</div>
        <div class="empty-text">开始输入以搜索单词</div>
        <div class="empty-sub">支持英文前缀搜索和中文释义搜索</div>
      </div>
    `;
    return;
  }

  // 搜索单词（前缀匹配）
  let results = wordService.searchWord(trimmed, 30);

  // 如果前缀搜索结果少，尝试中文释义搜索
  if (results.length < 10) {
    const totalCount = wordService.getTotalCount();
    const extraResults = [];
    const lowerQuery = trimmed.toLowerCase();
    for (let i = 1; i <= totalCount && extraResults.length < 20; i++) {
      const word = wordService.getWordById(i);
      if (!word) continue;
      // 跳过已在前缀结果中的
      if (results.some((r) => r.id === word.id)) continue;
      // 中文释义包含查询
      if (word.translation && word.translation.toLowerCase().includes(lowerQuery)) {
        extraResults.push(word);
      }
    }
    results = [...results, ...extraResults];
  }

  if (results.length === 0) {
    resultsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${Icon.search}</div>
        <div class="empty-text">没有找到匹配的单词</div>
        <div class="empty-sub">试试其他关键词</div>
      </div>
    `;
    return;
  }

  resultsContainer.innerHTML = `
    <p class="text-muted mb-1" style="font-size: 0.85rem;">找到 ${results.length} 个结果</p>
    ${results.map((word) => {
      // 查找教材位置
      let location = null;
      if (textbookService && textbookService.isLoaded()) {
        location = textbookService.findWordLocation(word.word);
      }
      return `
        <div class="card mb-1 search-result-item">
          <div class="search-result-main" onclick="speakWord('${word.word}')">
            <span class="search-result-word">${word.word}</span>
            ${word.phonetic ? `<span class="search-result-phonetic">${word.phonetic}</span>` : ''}
            ${word.pos ? `<span class="word-pos">${formatPos(word.pos)}</span>` : ''}
          </div>
          <div class="search-result-translation">${word.translation || ''}</div>
          ${location ? `
            <button class="learned-word-location" onclick="navigateToWordlistUnit(${location.book}, ${location.unit})">
              ${location.bookName} Unit ${location.unit}: ${location.title}
            </button>
          ` : ''}
        </div>
      `;
    }).join('')}
  `;
}

/* ===========================
   改错挑战页面（AI 五词改错）
   =========================== */
// 标记用户是否手动选择了挑战难度（每次进入挑战页面时重置为 false）
let userPickedDifficulty = false;

function renderChallenge() {
  if (ChallengeModule.isActive) return;

  // 每次渲染挑战页面时重置手动选择标记
  userPickedDifficulty = false;

  const section = document.getElementById('challenge');
  if (!section) return;

  const aiConfigured = window.aiService && aiService.isConfigured();

  if (!aiConfigured) {
    section.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${Icon.challenge}</div>
        <div class="empty-text">AI 改错挑战</div>
        <div class="empty-sub">AI 会生成一个包含生词的句子，故意加入语法错误，你来找出并修改</div>
        <div class="card mt-2" style="max-width: 400px; margin-left: auto; margin-right: auto; border-left: 4px solid var(--warning);">
          <div style="color: var(--warning); font-weight: 500;">${Icon.alert} 请先启动本地代理服务</div>
          <div class="text-muted" style="font-size: 0.85rem; margin-top: 0.25rem;">
            AI 功能需要本地代理服务运行中（默认地址 http://localhost:8787）。
            请在终端运行 <code>node local-proxy/server.js</code> 启动代理。
          </div>
          <button class="btn btn-secondary btn-sm mt-1" onclick="toggleSettings(true)">
            去设置
          </button>
        </div>
      </div>
    `;
    return;
  }

  // 渲染挑战设置界面
  section.innerHTML = `
    <div class="mb-3">
      <h2 style="font-size: 1.5rem; margin-bottom: 0.25rem;">${Icon.challenge} AI 改错挑战</h2>
      <p class="text-muted" style="font-size: 0.9rem;">AI 生成正规考试风格句子，故意设置语法错误，你来找出并修改</p>
    </div>

    <div class="card mb-2">
      <div class="card-header">${Icon.learn} 词汇来源</div>
      <div class="range-radio-group">
        <label class="range-radio-label">
          <input type="radio" name="challenge-source" value="random" checked>
          <span>随机生词</span>
        </label>
        <label class="range-radio-label">
          <input type="radio" name="challenge-source" value="textbook">
          <span>按教材选择</span>
        </label>
        <label class="range-radio-label">
          <input type="radio" name="challenge-source" value="learned">
          <span>已学单词</span>
        </label>
      </div>

      <div id="challenge-textbook-select" style="display: none; margin-top: 1rem;">
        <div class="flex gap-1" style="flex-wrap: wrap;">
          <select id="challenge-book-select" style="flex: 1; min-width: 120px;"></select>
          <select id="challenge-unit-select" style="flex: 1; min-width: 120px;">
            <option value="all">全部单元</option>
          </select>
        </div>
      </div>
    </div>

    <div class="card mb-2">
      <div class="card-header">${Icon.challenge} 难度等级</div>
      <div class="range-radio-group">
        <label class="range-radio-label">
          <input type="radio" name="challenge-difficulty" value="beginner" checked>
          <span>${Icon.hint} 小白</span>
        </label>
        <label class="range-radio-label">
          <input type="radio" name="challenge-difficulty" value="intermediate">
          <span>${Icon.learn} 中级</span>
        </label>
        <label class="range-radio-label">
          <input type="radio" name="challenge-difficulty" value="advanced">
          <span>${Icon.challenge} 高级</span>
        </label>
        <label class="range-radio-label">
          <input type="radio" name="challenge-difficulty" value="master">
          <span>${Icon.trophy} 大师</span>
        </label>
      </div>
      <p class="text-muted mt-1" style="font-size: 0.8rem;" id="difficulty-desc">
        小白：冠词/介词错误，句子较简单
      </p>
      <p class="text-muted" style="font-size: 0.75rem; margin-top: 0.25rem;">
        ${Icon.hint} 未手动选择时，将根据词汇量检测结果自动推荐：<strong>${({beginner:'小白',intermediate:'中级',advanced:'高级',master:'大师'})[getRecommendedDifficulty()]}</strong>
      </p>
    </div>

    <div class="card mb-2">
      <div class="card-header">${Icon.learn} 语法点（可选）</div>
      <div class="setting-desc">指定错误涉及的语法点，留空则由AI随机选择</div>
      <input type="text" id="challenge-grammar-point" placeholder="如：主谓一致、虚拟语气、定语从句..."
        style="width: 100%; padding: 0.5rem; border: 1px solid var(--border); border-radius: 6px;
        font-size: 0.9rem; background: var(--bg-primary); color: var(--text-primary);">
    </div>

    <div style="text-align: center; margin-top: 1.5rem;">
      <button class="btn btn-primary btn-lg" onclick="startChallenge()">
        开始挑战
      </button>
    </div>
  `;

  // 初始化教材选择器
  if (textbookService && textbookService.isLoaded()) {
    const books = textbookService.getBooks();
    const bookSelect = document.getElementById('challenge-book-select');
    if (bookSelect) {
      bookSelect.innerHTML = books.map((b) =>
        `<option value="${b.book}">${b.name}</option>`
      ).join('');
      bookSelect.onchange = () => onChallengeBookChange(bookSelect.value);
      if (books.length > 0) onChallengeBookChange(books[0].book);
    }
  }

  // 监听词汇来源变化
  document.querySelectorAll('input[name="challenge-source"]').forEach((radio) => {
    radio.onchange = () => {
      const textbookSelect = document.getElementById('challenge-textbook-select');
      if (textbookSelect) {
        textbookSelect.style.display = radio.value === 'textbook' ? 'block' : 'none';
      }
    };
  });

  // 监听难度变化
  const difficultyDescs = {
    beginner: '小白：冠词/介词错误，句子较简单',
    intermediate: '中级：主谓一致/时态错误，中等难度',
    advanced: '高级：虚拟语气/倒装/非谓语，较长句子',
    master: '大师：从句/独立主格/复杂结构，高难度长句',
  };
  document.querySelectorAll('input[name="challenge-difficulty"]').forEach((radio) => {
    radio.onchange = () => {
      // 标记用户已手动选择难度
      userPickedDifficulty = true;
      const desc = document.getElementById('difficulty-desc');
      if (desc) desc.textContent = difficultyDescs[radio.value] || '';
    };
  });
  // 初始化动态生成的图标
  if (window.initIcons) initIcons();
}

/**
 * 挑战教材书籍切换
 */
function onChallengeBookChange(bookValue) {
  const book = parseInt(bookValue, 10);
  if (!book || !textbookService || !textbookService.isLoaded()) return;
  const units = textbookService.getUnits(book);
  const unitSelect = document.getElementById('challenge-unit-select');
  if (!unitSelect) return;
  unitSelect.innerHTML = '<option value="all">全部单元</option>' +
    units.map((u) => `<option value="${u.unit}">Unit ${u.unit}: ${u.title}</option>`).join('');
}

/**
 * 开始改错挑战
 */
async function startChallenge() {
  if (!window.aiService || !aiService.isConfigured()) {
    showToast('请先在设置中配置 AI 服务', 'error');
    return;
  }

  const settings = settingsStorage.getSettings();

  // 读取选项
  const sourceRadio = document.querySelector('input[name="challenge-source"]:checked');
  const source = sourceRadio ? sourceRadio.value : 'random';
  const difficultyRadio = document.querySelector('input[name="challenge-difficulty"]:checked');
  const difficulty = difficultyRadio ? difficultyRadio.value : 'beginner';
  const grammarInput = document.getElementById('challenge-grammar-point');
  const grammarPoint = grammarInput ? grammarInput.value.trim() : '';

  // 获取单词
  let words = [];
  const wordCount = Math.min(5, settings.batchSize);

  if (source === 'random') {
    const totalCount = wordService.getTotalCount();
    if (totalCount === 0) return;
    const allIds = Array.from({ length: totalCount }, (_, i) => i + 1);
    const batchIds = randomPick(allIds, wordCount);
    words = batchIds.map((id) => wordService.getWordById(id)).filter(Boolean);
  } else if (source === 'textbook') {
    if (!textbookService || !textbookService.isLoaded()) {
      showToast('教材数据未加载', 'error');
      return;
    }
    const bookSelect = document.getElementById('challenge-book-select');
    const unitSelect = document.getElementById('challenge-unit-select');
    const book = parseInt(bookSelect ? bookSelect.value : '0', 10);
    const unitValue = unitSelect ? unitSelect.value : 'all';
    if (!book) { showToast('请选择教材', 'error'); return; }

    let matched = [];
    if (unitValue === 'all') {
      const units = textbookService.getUnits(book);
      for (const u of units) matched.push(...textbookService.getMatchedUnitWords(book, u.unit));
    } else {
      matched = textbookService.getMatchedUnitWords(book, parseInt(unitValue, 10));
    }
    words = randomPick(matched, Math.min(wordCount, matched.length));
  } else if (source === 'learned') {
    const progress = progressStorage.getAllProgress();
    const learnedIds = Object.keys(progress).map(Number);
    if (learnedIds.length === 0) { showToast('暂无已学单词', 'info'); return; }
    const batchIds = randomPick(learnedIds, Math.min(wordCount, learnedIds.length));
    words = batchIds.map((id) => wordService.getWordById(id)).filter(Boolean);
  }

  if (words.length < 3) {
    showToast('单词数量不足，无法生成挑战', 'error');
    return;
  }

  ChallengeModule.start(words, { difficulty, grammarPoint, userPickedDifficulty });
}

/* ===========================
   ChallengeModule - AI 改错挑战核心模块
   =========================== */
const ChallengeModule = {
  isActive: false,
  _words: [],
  _challengeData: null,
  _stats: { total: 0, correct: 0, wrong: 0 },
  _options: { difficulty: 'beginner', grammarPoint: '' },
  _hintIndex: 0,

  /**
   * 开始挑战
   * @param {object[]} words - 单词列表
   * @param {object} options - { difficulty, grammarPoint }
   */
  async start(words, options = {}) {
    this.isActive = true;
    this._words = words;
    // 如果用户没有手动选择难度，自动使用推荐难度（基于词汇量检测结果）
    let difficulty = options.difficulty || 'beginner';
    if (!options.userPickedDifficulty) {
      difficulty = getRecommendedDifficulty();
    }
    this._options = {
      difficulty: difficulty,
      grammarPoint: options.grammarPoint || '',
    };
    this._hintIndex = 0;

    const section = document.getElementById('challenge');
    if (!section) return;

    const difficultyNames = {
      beginner: '小白',
      intermediate: '中级',
      advanced: '高级',
      master: '大师',
    };

    section.innerHTML = `
      <div class="challenge-container">
        <div class="challenge-loading">
          <div class="spinner" style="margin: 2rem auto;"></div>
          <div style="text-align: center; margin-top: 1rem;">
            <div style="font-size: 1.1rem; font-weight: 500;">AI 正在出题...</div>
            <div class="text-muted" style="font-size: 0.85rem; margin-top: 0.5rem;">
              难度：${difficultyNames[this._options.difficulty]}
              ${this._options.grammarPoint ? ` | 语法点：${this._options.grammarPoint}` : ''}
            </div>
          </div>
          <div class="word-tags" style="display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; margin-top: 1rem;">
            ${words.map(w => `<span class="word-tag">${w.word}</span>`).join('')}
          </div>
        </div>
      </div>
    `;

    try {
      const challengeData = await aiService.generateChallengeSentence(
        words.map(w => w.word),
        words.map(w => w.translation),
        { difficulty: this._options.difficulty, grammarPoint: this._options.grammarPoint }
      );

      if (!challengeData) {
        throw new Error('AI 返回数据为空');
      }

      this._challengeData = challengeData;
      this._hintIndex = 0;
      this._renderChallenge();
    } catch (error) {
      console.error('[ChallengeModule] 生成挑战失败:', error);
      section.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon" style="color: var(--danger);">${Icon.wrong}</div>
          <div class="empty-text">题目生成失败</div>
          <div class="empty-sub">${error.message || '请检查 AI 服务配置后重试'}</div>
          <div class="flex gap-1 mt-2">
            <button class="btn btn-primary" onclick="startChallenge()">重试</button>
            <button class="btn btn-ghost" onclick="ChallengeModule.cancel()">返回</button>
          </div>
        </div>
      `;
      this.isActive = false;
      // 初始化动态生成的图标
      if (window.initIcons) initIcons();
    }
  },

  /**
   * 渲染挑战题目
   */
  _renderChallenge() {
    const section = document.getElementById('challenge');
    if (!section || !this._challengeData) return;

    const { sentence, translation, hints } = this._challengeData;
    const words = this._words;
    const difficultyNames = {
      beginner: '小白',
      intermediate: '中级',
      advanced: '高级',
      master: '大师',
    };

    section.innerHTML = `
      <div class="challenge-container">
        <!-- 难度标记 -->
        <div style="display: flex; justify-content: center; gap: 0.5rem; margin-bottom: 1rem;">
          <span style="background: var(--bg-secondary); padding: 0.2rem 0.6rem; border-radius: 999px; font-size: 0.8rem;">
            ${Icon.challenge} ${difficultyNames[this._options.difficulty]}
          </span>
          ${this._options.grammarPoint ? `
            <span style="background: rgba(33,150,243,0.1); color: var(--info); padding: 0.2rem 0.6rem; border-radius: 999px; font-size: 0.8rem;">
              ${Icon.learn} ${this._options.grammarPoint}
            </span>
          ` : ''}
        </div>

        <!-- 目标单词 -->
        <div class="word-tags" style="display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; margin-bottom: 1rem;">
          ${words.map(w => `<span class="word-tag">${w.word}</span>`).join('')}
        </div>

        <!-- 提示 -->
        <div class="text-muted" style="text-align: center; font-size: 0.85rem; margin-bottom: 1rem;">
          以下句子包含 ${words.length} 个目标单词，但有 <strong style="color: var(--danger);">一处语法错误</strong>。请找出并修改。
        </div>

        <!-- 原始句子 -->
        <div class="challenge-sentence" style="
          background: var(--bg-secondary); border-radius: var(--radius);
          padding: 1rem 1.25rem; margin-bottom: 1rem; border: 1px solid var(--border);
        ">
          <div style="font-size: 1.25rem; line-height: 1.6; font-weight: 500;">${sentence}</div>
          ${translation ? `<div class="text-muted" style="font-size: 0.85rem; margin-top: 0.5rem;">参考翻译：${translation}</div>` : ''}
        </div>

        <!-- 用户修改区 -->
        <div style="margin-bottom: 1rem;">
          <label style="font-size: 0.9rem; font-weight: 500; margin-bottom: 0.5rem; display: block;">
            请输入修改后的句子：
          </label>
          <textarea id="challenge-user-input" class="challenge-textarea" rows="3"
            placeholder="在这里输入你修改后的正确句子..."
            spellcheck="false" autocorrect="off" autocapitalize="off" autocomplete="off"
            data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false"
            style="width: 100%; padding: 0.75rem; border: 2px solid var(--border);
            border-radius: var(--radius); font-size: 1rem; resize: vertical;
            font-family: inherit; line-height: 1.6;
            background: var(--bg-primary); color: var(--text-primary);"
          >${sentence}</textarea>
        </div>

        <!-- 提示区域（默认隐藏） -->
        <div id="challenge-hints" style="display: none; margin-bottom: 1rem;"></div>

        <!-- 操作按钮 -->
        <div class="challenge-nav">
          <button class="btn btn-primary" onclick="ChallengeModule.submit()">
            提交答案
          </button>
          ${hints && hints.length > 0 ? `
            <button class="btn btn-secondary" id="challenge-hint-btn" onclick="ChallengeModule.showHint()">
              ${Icon.hint} 提示
            </button>
          ` : ''}
          <button class="btn btn-ghost" onclick="ChallengeModule.showAnswer()">
            直接看答案
          </button>
          <button class="btn btn-ghost" onclick="ChallengeModule.cancel()">
            退出挑战
          </button>
        </div>

        <!-- 结果展示区（隐藏） -->
        <div id="challenge-result" style="display: none;"></div>
      </div>
    `;
    // 初始化动态生成的图标
    if (window.initIcons) initIcons();
  },

  /**
   * 显示提示（递进式，每次点击显示一条）
   */
  showHint() {
    const hints = this._challengeData?.hints;
    if (!hints || hints.length === 0) return;

    const hintArea = document.getElementById('challenge-hints');
    if (!hintArea) return;

    if (this._hintIndex < hints.length) {
      const hint = hints[this._hintIndex];
      this._hintIndex++;

      hintArea.style.display = 'block';
      const currentHtml = hintArea.innerHTML;
      hintArea.innerHTML = currentHtml + `
        <div style="background: rgba(255,193,7,0.1); border-left: 3px solid var(--warning);
          padding: 0.5rem 0.75rem; border-radius: 4px; margin-bottom: 0.5rem; font-size: 0.9rem;">
          <strong style="color: var(--warning);">提示 ${this._hintIndex}：</strong> ${hint}
        </div>
      `;

      // 如果提示已用完，禁用按钮
      if (this._hintIndex >= hints.length) {
        const hintBtn = document.getElementById('challenge-hint-btn');
        if (hintBtn) {
          hintBtn.disabled = true;
          hintBtn.textContent = '提示已用完';
        }
      }
    }
  },

  /**
   * 提交用户答案（使用AI检查，而非1:1字符串匹配）
   */
  async submit() {
    const input = document.getElementById('challenge-user-input');
    const resultDiv = document.getElementById('challenge-result');
    if (!input || !resultDiv || !this._challengeData) return;

    const userAnswer = input.value.trim();
    const { sentence, corrected, error_type, error_explanation } = this._challengeData;

    if (!userAnswer) {
      showToast('请输入修改后的句子', 'error');
      return;
    }

    // 禁用提交按钮，显示检查中状态
    const submitBtn = input.closest('.challenge-container')?.querySelector('.btn-primary');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'AI 检查中...';
    }

    this._stats.total++;

    // 使用AI检查答案
    let isCorrect = false;
    let aiExplanation = '';
    try {
      const result = await aiService.checkChallengeAnswer(sentence, userAnswer, corrected, error_type);
      isCorrect = result.isCorrect;
      aiExplanation = result.explanation || '';
    } catch (e) {
      console.error('[ChallengeModule] AI检查失败，降级为字符串匹配:', e);
      const normalize = (s) => s.toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ').trim();
      isCorrect = normalize(userAnswer) === normalize(corrected);
    }

    if (isCorrect) {
      this._stats.correct++;
    } else {
      this._stats.wrong++;
    }

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `
      <div class="challenge-result ${isCorrect ? 'correct' : 'wrong'}" style="
        margin-top: 1rem; padding: 1rem; border-radius: var(--radius);
        border: 2px solid ${isCorrect ? 'var(--accent)' : 'var(--danger)'};
        background: ${isCorrect ? 'rgba(76,175,80,0.08)' : 'rgba(244,67,54,0.08)'};
      ">
        <div style="font-size: 1.2rem; font-weight: 600; margin-bottom: 0.5rem;">
          ${isCorrect ? Icon.check + ' 回答正确！' : Icon.wrong + ' 回答有误'}
        </div>

        ${aiExplanation ? `
        <div style="margin-top: 0.5rem; padding: 0.5rem; background: var(--bg-secondary); border-radius: 4px; font-size: 0.85rem;">
          <strong>AI点评：</strong> ${aiExplanation}
        </div>
        ` : ''}

        <div style="margin-top: 0.75rem;">
          <div style="font-size: 0.9rem; color: var(--text-secondary);">错误类型：${error_type || '未知'}</div>
          <div style="font-size: 0.9rem; color: var(--text-secondary); margin-top: 0.25rem;">错误解析：${error_explanation || '暂无'}</div>
        </div>

        <div style="margin-top: 0.75rem;">
          <div style="font-size: 0.85rem; color: var(--text-secondary);">你的答案：</div>
          <div style="padding: 0.25rem 0.5rem; font-size: 1rem;">${userAnswer}</div>
        </div>

        ${!isCorrect ? `
        <div style="margin-top: 0.5rem;">
          <div style="font-size: 0.85rem; color: var(--text-secondary);">参考答案：</div>
          <div style="padding: 0.25rem 0.5rem; font-size: 1rem; color: var(--accent); font-weight: 500;">${corrected}</div>
        </div>
        ` : ''}
      </div>

      <div class="flex gap-1 mt-2" style="justify-content: center;">
        <button class="btn btn-primary" onclick="startChallenge()">再来一题</button>
        <button class="btn btn-ghost" onclick="ChallengeModule.cancel()">返回</button>
      </div>
    `;

    showToast(isCorrect ? '改错成功！' : '改错失败，看看参考答案吧', isCorrect ? 'success' : 'error');
    resultDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },

  /**
   * 直接显示答案
   */
  showAnswer() {
    const resultDiv = document.getElementById('challenge-result');
    const input = document.getElementById('challenge-user-input');
    if (!resultDiv || !this._challengeData) return;

    if (input) input.disabled = true;

    this._stats.total++;
    this._stats.wrong++;

    const { corrected, error_type, error_explanation } = this._challengeData;

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `
      <div class="challenge-result" style="
        margin-top: 1rem; padding: 1rem; border-radius: var(--radius);
        border: 2px solid var(--warning);
        background: rgba(255,152,0,0.08);
      ">
        <div style="font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem;">
          ${Icon.hint} 正确答案
        </div>
        <div style="padding: 0.5rem; font-size: 1rem; color: var(--accent); font-weight: 500;">${corrected}</div>
        <div style="margin-top: 0.5rem; font-size: 0.85rem; color: var(--text-secondary);">
          错误类型：${error_type || '未知'}<br>
          错误解析：${error_explanation || '暂无'}
        </div>
      </div>

      <div class="flex gap-1 mt-2" style="justify-content: center;">
        <button class="btn btn-primary" onclick="startChallenge()">再来一题</button>
        <button class="btn btn-ghost" onclick="ChallengeModule.cancel()">返回</button>
      </div>
    `;
  },

  /**
   * 取消挑战
   */
  cancel() {
    this.isActive = false;
    this._challengeData = null;
    navigate('challenge');
  },
};

/* ===========================
   动态难度推荐
   =========================== */

/**
 * 根据最近一次词汇量检测结果返回推荐难度
 * - 预估词汇量 < 1000 → 'beginner'
 * - 1000 ~ 2000 → 'intermediate'
 * - 2000 ~ 3000 → 'advanced'
 * - > 3000 → 'master'
 * - 没有测试过 → 默认 'intermediate'
 * @returns {'beginner'|'intermediate'|'advanced'|'master'} 推荐难度等级
 */
function getRecommendedDifficulty() {
  const latest = vocabTestStorage.getLatestResult();
  // 没有测试记录时返回默认难度
  if (!latest) return 'intermediate';

  const v = latest.estimatedVocab;
  if (v < 1000) return 'beginner';
  if (v < 2000) return 'intermediate';
  if (v <= 3000) return 'advanced';
  return 'master';
}

/* ===========================
   词汇量检测模块
   =========================== */

const VocabTestModule = {
  /** 每个难度的题目数量 */
  DIFFICULTY_SIZE: 10,
  /** 总题数（4 个难度 × 10 题） */
  TEST_SIZE: 40,
  /** 总词汇量基数（高考3500词） */
  TOTAL_VOCAB: 3500,

  /**
   * 4 个难度等级配置
   * key：内部标识；name：显示名称；desc：说明；color：徽章颜色
   */
  DIFFICULTIES: [
    { key: 'beginner', name: '小白', desc: '教材内基础词汇', color: 'var(--accent)' },
    { key: 'normal',   name: '普通', desc: '教材内中等词汇', color: 'var(--info)' },
    { key: 'medium',   name: '中等', desc: '教材内较难词汇', color: 'var(--warning)' },
    { key: 'hell',     name: '地狱', desc: '教材外词汇',     color: 'var(--danger)' },
  ],

  /** 内部状态 */
  _words: [],            // 本次测试的全部单词（按难度顺序拼接：小白→普通→中等→地狱）
  /** 每道题的题型：'choice'（选择题）| 'spell'（拼写题） */
  _questionTypes: [],
  /** 每道题所属的难度 key（beginner/normal/medium/hell） */
  _difficultyOf: [],
  _currentIndex: 0,
  _correct: 0,
  _wrongWords: [],
  _options: [],
  _answered: false,
  /** 测试开始时间戳 */
  _testStartTime: 0,
  /** 分难度正确数统计 */
  _correctByDifficulty: { beginner: 0, normal: 0, medium: 0, hell: 0 },
  /** 教材单词集合（小写），缓存避免重复构建 */
  _textbookWordSet: null,
  /** AI 综合评分结果（测试完成后填充） */
  _aiEvaluation: null,

  /**
   * 开始词汇量检测（4 个难度，共 40 题）
   */
  start() {
    if (!wordService || !wordService.isLoaded()) {
      showToast('词典未加载，请稍后再试', 'error');
      return;
    }

    const dict = wordService._dictionary;
    if (!dict || dict.length === 0) {
      showToast('词典数据为空', 'error');
      return;
    }

    // 构建 4 个难度的词库
    const pools = this._buildPools(dict);
    // 检查各难度词库是否充足（每个难度至少需要 DIFFICULTY_SIZE 个）
    const insufficient = this.DIFFICULTIES.filter((d) => pools[d.key].length < this.DIFFICULTY_SIZE);
    if (insufficient.length > 0) {
      showToast(`词库数据不足（${insufficient.map((d) => d.name).join('、')}），无法进行检测`, 'error');
      return;
    }

    // 从每个难度抽取 10 个词，并按难度顺序拼接（小白→普通→中等→地狱）
    this._words = [];
    this._questionTypes = [];
    this._difficultyOf = [];
    for (const diff of this.DIFFICULTIES) {
      const picked = this._sampleFromPool(pools[diff.key], this.DIFFICULTY_SIZE);
      for (const w of picked) {
        this._words.push(w);
        // 题型随机混合：选择题 / 拼写题
        this._questionTypes.push(Math.random() < 0.5 ? 'choice' : 'spell');
        this._difficultyOf.push(diff.key);
      }
    }

    // 重置状态
    this._currentIndex = 0;
    this._correct = 0;
    this._wrongWords = [];
    this._answered = false;
    this._testStartTime = Date.now();
    this._correctByDifficulty = { beginner: 0, normal: 0, medium: 0, hell: 0 };
    this._aiEvaluation = null;

    // 导航到首页区域进行检测（复用 home section）
    navigate('home');

    this._renderQuestion();
  },

  /**
   * 构建教材单词集合（小写），用于判断单词是否属于教材
   * 结果缓存到 _textbookWordSet
   * @returns {Set<string>} 教材单词集合
   */
  _buildTextbookWordSet() {
    if (this._textbookWordSet) return this._textbookWordSet;
    const set = new Set();
    try {
      if (textbookService && textbookService.isLoaded()) {
        const all = textbookService.getAllTextbookWords();
        for (const item of all) {
          if (item && item.word) {
            const w = String(item.word).toLowerCase().trim();
            if (w) set.add(w);
          }
        }
      }
    } catch (e) {
      console.warn('[VocabTestModule] 构建教材单词集合失败:', e);
    }
    this._textbookWordSet = set;
    return set;
  },

  /**
   * 构建 4 个难度的词库
   * - 小白(beginner)：教材内 collins 4-5 星或 oxford 3000（最常用、最简单）
   * - 普通(normal)：教材内 collins 3 星（较常用）
   * - 中等(medium)：教材内 collins 1-2 星（较少用、较难）
   * - 地狱(hell)：词典中不在教材内的词（教材外词汇）
   * @param {Array} dict - wordService._dictionary
   * @returns {Object} { beginner:[], normal:[], medium:[], hell:[] }
   */
  _buildPools(dict) {
    const tbSet = this._buildTextbookWordSet();
    const pools = { beginner: [], normal: [], medium: [], hell: [] };

    for (const w of dict) {
      // 仅保留有中文释义、且是单个单词（非短语/不含数字/不含连字符）的词条
      if (!w || !w.word) continue;
      const word = String(w.word).trim();
      if (!word || word.includes(' ') || word.includes('-') || /\d/.test(word)) continue;
      if (!w.translation || !w.translation.trim()) continue;

      const collins = Number(w.collins) || 0;
      const oxford = Number(w.oxford) || 0;
      const isInTextbook = tbSet.has(word.toLowerCase());

      if (isInTextbook) {
        // 教材内：按 collins 星级分到前三个难度
        // Collins 星级越高 = 词越常用 = 越简单
        if ((collins >= 4 && collins <= 5) || oxford === 1) {
          // 4-5星或Oxford 3000：最常用、最简单 → 小白难度
          pools.beginner.push(w);
        } else if (collins === 3) {
          // 3星：较常用 → 普通难度
          pools.normal.push(w);
        } else if (collins >= 1 && collins <= 2) {
          // 1-2星：较少用、较难 → 中等难度
          pools.medium.push(w);
        }
        // collins 0 的教材词不纳入前三个难度（样本充足，无需兜底）
      } else {
        // 教材外：地狱难度
        pools.hell.push(w);
      }
    }

    return pools;
  },

  /**
   * 从词库中随机抽取 n 个不重复的单词
   * @param {Array} pool - 词库
   * @param {number} n - 抽取数量
   * @returns {Array} 抽取结果
   */
  _sampleFromPool(pool, n) {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(n, shuffled.length));
  },

  /**
   * 获取当前题目所属难度配置
   * @returns {Object} 难度配置对象
   */
  _currentDifficulty() {
    const key = this._difficultyOf[this._currentIndex];
    return this.DIFFICULTIES.find((d) => d.key === key) || this.DIFFICULTIES[0];
  },

  /**
   * 生成4个选项（1正确 + 3干扰）- 选择题用中文释义
   * @param {object} currentWord - 当前单词
   * @returns {string[]} 4个选项的中文释义
   */
  _generateOptions(currentWord) {
    const dict = wordService._dictionary;
    const pool = dict.filter((w) =>
      w.translation && w.translation.trim() &&
      w.word !== currentWord.word
    );

    // 随机抽取3个干扰项
    const distractors = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);
    const options = [
      currentWord.translation,
      ...distractors.map((w) => w.translation),
    ];

    // 打乱顺序
    return options.sort(() => Math.random() - 0.5);
  },

  /**
   * 生成4个拼写提示选项（不直接给出正确单词）
   * - 2 个为"残缺片段"（如正确答案 abandon → a_an_on）
   * - 2 个为"近音错误词"（如 abandon → abandend / ebendon）
   * 这些选项仅作为参考，用户点击后填入输入框自行修改
   * @param {object} currentWord - 当前单词
   * @returns {string[]} 4个提示选项
   */
  _generateSpellOptions(currentWord) {
    const word = String((currentWord && currentWord.word) || '');
    const opts = [];
    const seen = new Set();

    // 入栈前校验：空值、与正确词相同（大小写不敏感）均跳过，避免直接泄露答案
    const push = (s) => {
      if (!s) return;
      if (s.toLowerCase() === word.toLowerCase()) return;
      if (seen.has(s)) return;
      seen.add(s);
      opts.push(s);
    };

    // 1) 生成 2 个残缺片段（保留首尾及部分字母，其余用 _ 替换）
    push(this._makeFragment(word, 0.45));
    push(this._makeFragment(word, 0.6));

    // 2) 生成 2 个近音错误词（替换元音/双写辅音等，发音相近但拼写错误）
    push(this._makeNearMisspell(word));
    push(this._makeNearMisspell(word));

    // 兜底1：不足 4 个时，用字典中相近长度的词补齐
    if (opts.length < 4) {
      const dict = wordService._dictionary;
      const len = word.length;
      const candidates = (dict || []).filter((w) =>
        w && w.word && w.word !== word &&
        Math.abs(w.word.length - len) <= 2 &&
        w.word.length >= 3
      );
      const shuffled = [...candidates].sort(() => Math.random() - 0.5);
      for (const c of shuffled) {
        if (opts.length >= 4) break;
        push(c.word);
      }
    }

    // 兜底2：仍不足 4 个（极小概率），用占位符补齐
    while (opts.length < 4) {
      push(`____${opts.length + 1}`);
    }

    // 截取 4 个并打乱顺序
    return opts.slice(0, 4).sort(() => Math.random() - 0.5);
  },

  /**
   * 生成残缺片段：保留首尾字母，按比例将中间字母替换为 _
   * 例如 abandon + hideRatio 0.45 → a_an_on
   * @param {string} word - 原单词
   * @param {number} hideRatio - 隐藏比例（0~1）
   * @returns {string} 残缺片段
   */
  _makeFragment(word, hideRatio) {
    if (!word) return '';
    const chars = word.split('');
    const n = chars.length;
    if (n < 2) return word;
    if (n === 2) {
      // 两个字母的词：隐藏其中一个，避免直接泄露完整答案
      return Math.random() < 0.5 ? (chars[0] + '_') : ('_' + chars[1]);
    }
    // 首尾必保留，仅隐藏中间位置
    const indices = [];
    for (let i = 1; i < n - 1; i++) indices.push(i);
    const hideCount = Math.max(1, Math.min(indices.length, Math.round(indices.length * hideRatio)));
    const shuffledIdx = [...indices].sort(() => Math.random() - 0.5);
    const hideSet = new Set(shuffledIdx.slice(0, hideCount));
    return chars.map((c, i) => (hideSet.has(i) ? '_' : c)).join('');
  },

  /**
   * 生成近音错误词：对元音/相近辅音做轻微扰动，使发音相近但拼写错误
   * 例如 abandon → abandend / ebendon
   * @param {string} word - 原单词
   * @returns {string} 近音错误词
   */
  _makeNearMisspell(word) {
    if (!word) return '';
    if (word.length < 3) return word + 'e';
    const vowels = ['a', 'e', 'i', 'o', 'u'];
    const consonantSwap = { c: 's', s: 'c', k: 'c', f: 'v', v: 'f' };
    let chars = word.split('');
    let changed = false;

    // 策略1：替换一个元音
    const vowelPositions = [];
    for (let i = 0; i < chars.length; i++) {
      if (vowels.includes(chars[i])) vowelPositions.push(i);
    }
    if (vowelPositions.length > 0 && Math.random() < 0.8) {
      const pos = vowelPositions[Math.floor(Math.random() * vowelPositions.length)];
      const cur = chars[pos];
      const others = vowels.filter((v) => v !== cur);
      chars[pos] = others[Math.floor(Math.random() * others.length)];
      changed = true;
    }

    // 策略2：双写或减半一个辅音
    if (!changed) {
      const consPositions = [];
      for (let i = 1; i < chars.length - 1; i++) {
        const c = chars[i];
        if (!vowels.includes(c)) {
          if (c === chars[i + 1]) consPositions.push({ i, type: 'half' });
          else if (c !== chars[i - 1]) consPositions.push({ i, type: 'double' });
        }
      }
      if (consPositions.length > 0) {
        const pick = consPositions[Math.floor(Math.random() * consPositions.length)];
        if (pick.type === 'double') {
          chars.splice(pick.i + 1, 0, chars[pick.i]);
        } else {
          chars.splice(pick.i, 1);
        }
        changed = true;
      }
    }

    // 策略3：相邻辅音替换（如 c↔s、k↔c）
    if (!changed) {
      for (let i = 1; i < chars.length; i++) {
        const c = chars[i];
        if (consonantSwap[c] && Math.random() < 0.5) {
          chars[i] = consonantSwap[c];
          changed = true;
          break;
        }
      }
    }

    let result = chars.join('');
    // 最后兜底：必然要产出与原词不同的词
    if (!changed || result === word) {
      result = word.split('');
      if (result.length > 2) {
        result[1] = vowels[(vowels.indexOf((result[1] || '').toLowerCase()) + 1) % vowels.length] || 'e';
      }
      result = result.join('');
    }
    return result === word ? word + 'e' : result;
  },

  /**
   * 渲染当前题目（根据题型分发到选择题或拼写题）
   */
  _renderQuestion() {
    const section = document.getElementById('home');
    if (!section) return;

    const word = this._words[this._currentIndex];
    if (!word) {
      this._renderResults();
      return;
    }

    const questionType = this._questionTypes[this._currentIndex];
    this._answered = false;

    if (questionType === 'spell') {
      this._renderSpellQuestion(word);
    } else {
      this._renderChoiceQuestion(word);
    }
  },

  /**
   * 渲染选择题题目（看英文选中文释义）
   * @param {object} word - 当前单词
   */
  _renderChoiceQuestion(word) {
    const section = document.getElementById('home');
    if (!section) return;

    this._options = this._generateOptions(word);
    const progress = ((this._currentIndex / this._words.length) * 100).toFixed(0);
    const diff = this._currentDifficulty();

    section.innerHTML = `
      <div style="max-width: 600px; margin: 0 auto;">
        <!-- 检测头部 -->
        <div class="card mb-2">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <h2 style="font-size: 1.2rem; margin: 0;">${Icon.vocabTest} 词汇量检测</h2>
            <button class="btn btn-ghost btn-sm" onclick="VocabTestModule.cancel()">退出</button>
          </div>
          <div class="progress-labeled">
            <div class="progress-bar">
              <div class="progress-bar-fill" style="width: ${progress}%"></div>
            </div>
            <span class="progress-text">${this._currentIndex + 1}/${this._words.length}</span>
          </div>
          <div style="margin-top: 0.5rem; display: flex; gap: 0.4rem; flex-wrap: wrap;">
            <span style="background: var(--bg-secondary); padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.75rem;">${Icon.learned} 选择题</span>
            <span style="background: ${diff.color}; color: #fff; padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.75rem; opacity: 0.92;">${diff.name}难度</span>
          </div>
        </div>

        <!-- 题目区域 -->
        <div class="card" style="text-align: center; padding: 2rem 1.5rem;">
          <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem;">请选择该单词的正确释义</div>
          <div style="font-size: 2rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.25rem;">
            ${word.word}
          </div>
          ${word.phonetic ? `<div style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1rem;">${word.phonetic}</div>` : '<div style="margin-bottom: 1rem;"></div>'}
          <button class="btn btn-ghost btn-sm" onclick="speakWord('${word.word.replace(/'/g, "\\'")}')" style="margin-bottom: 1rem;">
            ${Icon.speak} 朗读
          </button>

          <!-- 选项 -->
          <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 1rem;">
            ${this._options.map((opt, i) => `
              <button class="btn btn-secondary vocab-test-option"
                onclick="VocabTestModule.answer(${i})"
                data-index="${i}"
                style="text-align: left; padding: 0.75rem 1rem; font-size: 0.95rem; white-space: normal; word-break: break-word;">
                <span style="display: inline-block; width: 1.5rem; font-weight: 700; color: var(--accent);">${String.fromCharCode(65 + i)}.</span>
                ${opt}
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    `;
    // 初始化动态生成的图标
    if (window.initIcons) initIcons();
  },

  /**
   * 渲染拼写题题目（看中文释义拼写英文）
   * @param {object} word - 当前单词
   */
  _renderSpellQuestion(word) {
    const section = document.getElementById('home');
    if (!section) return;

    this._options = this._generateSpellOptions(word);
    const progress = ((this._currentIndex / this._words.length) * 100).toFixed(0);
    const diff = this._currentDifficulty();

    section.innerHTML = `
      <div style="max-width: 600px; margin: 0 auto;">
        <!-- 检测头部 -->
        <div class="card mb-2">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <h2 style="font-size: 1.2rem; margin: 0;">${Icon.vocabTest} 词汇量检测</h2>
            <button class="btn btn-ghost btn-sm" onclick="VocabTestModule.cancel()">退出</button>
          </div>
          <div class="progress-labeled">
            <div class="progress-bar">
              <div class="progress-bar-fill" style="width: ${progress}%"></div>
            </div>
            <span class="progress-text">${this._currentIndex + 1}/${this._words.length}</span>
          </div>
          <div style="margin-top: 0.5rem; display: flex; gap: 0.4rem; flex-wrap: wrap;">
            <span style="background: var(--bg-secondary); padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.75rem;">${Icon.learn} 拼写题</span>
            <span style="background: ${diff.color}; color: #fff; padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.75rem; opacity: 0.92;">${diff.name}难度</span>
          </div>
        </div>

        <!-- 题目区域 -->
        <div class="card" style="text-align: center; padding: 2rem 1.5rem;">
          <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem;">请根据释义拼写对应的英文单词</div>
          <!-- 中文释义 -->
          <div style="font-size: 1.4rem; font-weight: 600; color: var(--text-primary); margin-bottom: 0.5rem;">
            ${word.translation}
          </div>
          ${word.phonetic ? `<div style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1rem;">${word.phonetic}</div>` : '<div style="margin-bottom: 1rem;"></div>'}
          <button class="btn btn-ghost btn-sm" onclick="speakWord('${word.word.replace(/'/g, "\\'")}')" style="margin-bottom: 1rem;">
            ${Icon.speak} 朗读
          </button>

          <!-- 输入框 -->
          <input type="text" id="vocab-spell-input" autocomplete="off" autocapitalize="off" spellcheck="false"
            placeholder="在此输入英文单词..."
            style="width: 100%; max-width: 320px; padding: 0.75rem 1rem; font-size: 1.1rem; text-align: center;
            border: 2px solid var(--border); border-radius: var(--radius); background: var(--bg-primary); color: var(--text-primary);"
            onkeydown="if(event.key==='Enter'){event.preventDefault();VocabTestModule.submitSpell();}" />

          <!-- 拼写提示选项：残缺片段(_)或近音错误词，仅作参考（点击填入输入框后需自行修改） -->
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 1rem; margin-bottom: 0.5rem;">${Icon.hint} 参考提示：含 _ 的为残缺片段，其余为近音错误词，点击可填入作为草稿</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 0.5rem;">
            ${this._options.map((opt, i) => `
              <button class="btn btn-secondary vocab-spell-option"
                onclick="VocabTestModule.fillSpell(${i})"
                data-index="${i}"
                style="padding: 0.5rem 0.75rem; font-size: 0.95rem; font-family: monospace, Consolas, Menlo; letter-spacing: 0.05em;">
                ${opt}
              </button>
            `).join('')}
          </div>

          <!-- 提交按钮 -->
          <button class="btn btn-primary" id="vocab-spell-submit" onclick="VocabTestModule.submitSpell()" style="margin-top: 1rem;">提交答案</button>
        </div>
      </div>
    `;

    // 自动聚焦输入框
    const input = document.getElementById('vocab-spell-input');
    if (input) input.focus();
    // 初始化动态生成的图标
    if (window.initIcons) initIcons();
  },

  /**
   * 处理选择题答题
   * @param {number} optionIndex - 选项索引
   */
  answer(optionIndex) {
    if (this._answered) return;
    this._answered = true;

    const word = this._words[this._currentIndex];
    const selected = this._options[optionIndex];
    const isCorrect = selected === word.translation;

    if (isCorrect) {
      this._correct++;
      // 累计该难度正确数
      const dkey = this._difficultyOf[this._currentIndex];
      if (dkey) this._correctByDifficulty[dkey] = (this._correctByDifficulty[dkey] || 0) + 1;
    } else {
      this._wrongWords.push({
        word: word.word,
        correct: word.translation,
        selected: selected,
        type: 'choice',
        difficulty: this._difficultyOf[this._currentIndex],
      });
    }

    // 高亮选项
    const buttons = document.querySelectorAll('.vocab-test-option');
    buttons.forEach((btn) => {
      const idx = parseInt(btn.dataset.index, 10);
      btn.disabled = true;
      btn.style.pointerEvents = 'none';
      if (this._options[idx] === word.translation) {
        btn.style.borderColor = 'var(--accent)';
        btn.style.background = 'rgba(76,175,80,0.12)';
        btn.style.color = 'var(--accent)';
        btn.innerHTML += ' ' + Icon.check;
      } else if (idx === optionIndex) {
        btn.style.borderColor = 'var(--danger)';
        btn.style.background = 'rgba(244,67,54,0.12)';
        btn.style.color = 'var(--danger)';
        btn.innerHTML += ' ' + Icon.wrong;
      }
    });

    // 延迟后进入下一题
    setTimeout(() => {
      this._currentIndex++;
      if (this._currentIndex >= this._words.length) {
        this._renderResults();
      } else {
        this._renderQuestion();
      }
    }, 1200);
  },

  /**
   * 拼写题：点击提示选项自动填入输入框
   * @param {number} optionIndex - 选项索引
   */
  fillSpell(optionIndex) {
    if (this._answered) return;
    const input = document.getElementById('vocab-spell-input');
    if (input) {
      input.value = this._options[optionIndex];
      input.focus();
    }
  },

  /**
   * 拼写题：提交答案并判分（不区分大小写）
   */
  submitSpell() {
    if (this._answered) return;

    const input = document.getElementById('vocab-spell-input');
    if (!input) return;

    const userInput = input.value.trim();
    if (!userInput) {
      showToast('请输入英文单词', 'info');
      return;
    }

    this._answered = true;
    const word = this._words[this._currentIndex];
    // 不区分大小写比较
    const isCorrect = userInput.toLowerCase() === word.word.toLowerCase();

    if (isCorrect) {
      this._correct++;
      // 累计该难度正确数
      const dkey = this._difficultyOf[this._currentIndex];
      if (dkey) this._correctByDifficulty[dkey] = (this._correctByDifficulty[dkey] || 0) + 1;
    } else {
      this._wrongWords.push({
        word: word.word,
        correct: word.translation,
        selected: userInput,
        type: 'spell',
        difficulty: this._difficultyOf[this._currentIndex],
      });
    }

    // 禁用所有提示选项（提示为残缺片段/近音错误词，均非最终答案，故不高亮"正确项"）
    const buttons = document.querySelectorAll('.vocab-spell-option');
    buttons.forEach((btn) => {
      btn.disabled = true;
      btn.style.pointerEvents = 'none';
      btn.style.opacity = '0.55';
    });

    // 标记输入框对错
    if (isCorrect) {
      input.style.borderColor = 'var(--accent)';
      input.style.background = 'rgba(76,175,80,0.08)';
      input.disabled = true;
    } else {
      input.style.borderColor = 'var(--danger)';
      input.style.background = 'rgba(244,67,54,0.08)';
      input.disabled = true;
      // 显示正确答案
      input.value = `${userInput}  →  ${word.word}`;
    }

    // 禁用提交按钮
    const submitBtn = document.getElementById('vocab-spell-submit');
    if (submitBtn) submitBtn.disabled = true;

    // 延迟后进入下一题
    setTimeout(() => {
      this._currentIndex++;
      if (this._currentIndex >= this._words.length) {
        this._renderResults();
      } else {
        this._renderQuestion();
      }
    }, 1500);
  },

  /**
   * 渲染检测结果
   */
  _renderResults() {
    const section = document.getElementById('home');
    if (!section) return;

    const accuracy = Math.round((this._correct / this._words.length) * 100);
    const estimatedVocab = Math.round((this._correct / this._words.length) * this.TOTAL_VOCAB);
    const testTime = this._testStartTime ? Math.round((Date.now() - this._testStartTime) / 1000) : 0;

    // 保存检测结果到本地存储（用于动态难度推荐）
    vocabTestStorage.saveResult({
      estimatedVocab: estimatedVocab,
      accuracy: accuracy,
      testTime: testTime,
      correctCount: this._correct,
      totalCount: this._words.length,
      timestamp: Date.now(),
    });

    // 格式化测试用时
    const timeStr = testTime >= 60
      ? `${Math.floor(testTime / 60)}分${testTime % 60}秒`
      : `${testTime}秒`;

    // 推荐难度（对应改错挑战的难度体系：beginner/intermediate/advanced/master）
    const recommendedDifficulty = getRecommendedDifficulty();
    const difficultyNames = {
      beginner: '小白',
      intermediate: '中级',
      advanced: '高级',
      master: '大师',
    };

    // 难度名称映射（词汇量检测自身的 4 个难度，用于错题展示）
    const diffNameMap = {};
    this.DIFFICULTIES.forEach((d) => { diffNameMap[d.key] = d.name; });

    // 分难度成绩条
    const diffBarsHtml = this.DIFFICULTIES.map((d) => {
      const correct = this._correctByDifficulty[d.key] || 0;
      const pct = Math.round((correct / this.DIFFICULTY_SIZE) * 100);
      return `
        <div style="margin-bottom: 0.6rem;">
          <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 0.2rem;">
            <span style="color: ${d.color}; font-weight: 600;">${d.name}</span>
            <span style="color: var(--text-muted);">${correct}/${this.DIFFICULTY_SIZE}</span>
          </div>
          <div class="progress-bar" style="height: 8px;">
            <div class="progress-bar-fill" style="width: ${pct}%; background: ${d.color};"></div>
          </div>
        </div>
      `;
    }).join('');

    // 评级
    let level = '';
    let levelColor = '';
    let levelIcon = '';
    if (estimatedVocab >= 3000) {
      level = '词汇大师'; levelColor = 'var(--accent)'; levelIcon = Icon.trophy;
    } else if (estimatedVocab >= 2000) {
      level = '词汇达人'; levelColor = 'var(--info)'; levelIcon = Icon.trophy;
    } else if (estimatedVocab >= 1000) {
      level = '稳步前进'; levelColor = 'var(--warning)'; levelIcon = Icon.learn;
    } else {
      level = '初出茅庐'; levelColor = 'var(--danger)'; levelIcon = Icon.hint;
    }

    section.innerHTML = `
      <div style="max-width: 600px; margin: 0 auto;">
        <div class="card" style="text-align: center; padding: 2rem 1.5rem;">
          <div style="font-size: 3rem; margin-bottom: 0.5rem;">${levelIcon}</div>
          <h2 style="font-size: 1.3rem; margin-bottom: 0.25rem;">检测完成</h2>
          <div style="font-size: 0.9rem; color: ${levelColor}; font-weight: 600; margin-bottom: 1.5rem;">${level}</div>

          <!-- 估算词汇量 -->
          <div style="background: var(--bg-secondary); border-radius: var(--radius); padding: 1.5rem; margin-bottom: 1rem;">
            <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.25rem;">预估词汇量</div>
            <div style="font-size: 2.5rem; font-weight: 700; color: ${levelColor};">${estimatedVocab}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">/ ${this.TOTAL_VOCAB}</div>
          </div>

          <!-- 统计数据 -->
          <div style="display: flex; justify-content: center; gap: 2rem; margin-bottom: 1rem; flex-wrap: wrap;">
            <div>
              <div style="font-size: 1.5rem; font-weight: 700; color: var(--accent);">${this._correct}</div>
              <div style="font-size: 0.8rem; color: var(--text-muted);">正确</div>
            </div>
            <div>
              <div style="font-size: 1.5rem; font-weight: 700; color: var(--danger);">${this._words.length - this._correct}</div>
              <div style="font-size: 0.8rem; color: var(--text-muted);">错误</div>
            </div>
            <div>
              <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-primary);">${accuracy}%</div>
              <div style="font-size: 0.8rem; color: var(--text-muted);">正确率</div>
            </div>
            <div>
              <div style="font-size: 1.5rem; font-weight: 700; color: var(--info);">${timeStr}</div>
              <div style="font-size: 0.8rem; color: var(--text-muted);">用时</div>
            </div>
          </div>

          <div class="progress-labeled" style="margin-bottom: 1rem;">
            <div class="progress-bar">
              <div class="progress-bar-fill" style="width: ${accuracy}%"></div>
            </div>
            <span class="progress-text">${accuracy}%</span>
          </div>

          <!-- 分难度成绩 -->
          <div style="text-align: left; background: var(--bg-secondary); border-radius: var(--radius); padding: 0.85rem 1rem; margin-bottom: 1rem;">
            <div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 0.5rem; text-align: center;">${Icon.learned} 分难度成绩</div>
            ${diffBarsHtml}
          </div>

          <!-- 推荐难度 -->
          <div style="background: rgba(33,150,243,0.08); border: 1px solid rgba(33,150,243,0.2); border-radius: var(--radius); padding: 0.75rem 1rem; margin-bottom: 1rem; font-size: 0.85rem;">
            <span style="color: var(--text-muted);">基于本次检测，推荐改错挑战难度：</span>
            <span style="color: var(--info); font-weight: 600;">${difficultyNames[recommendedDifficulty]}</span>
          </div>

          <!-- AI 综合评分（异步填充） -->
          <div id="vocab-ai-eval" style="margin-bottom: 1rem;"></div>

          <!-- 错题回顾 -->
          ${this._wrongWords.length > 0 ? `
          <details style="text-align: left; margin-bottom: 1rem;">
            <summary style="cursor: pointer; font-weight: 600; padding: 0.5rem;">${Icon.learned} 错题回顾（${this._wrongWords.length}个）</summary>
            <div style="padding: 0.5rem 0;">
              ${this._wrongWords.map((w) => `
                <div style="padding: 0.5rem; border-bottom: 1px solid var(--border);">
                  <div style="font-weight: 600;">${w.word}
                    <span style="font-size: 0.7rem; font-weight: 400; color: var(--text-muted); margin-left: 0.5rem;">${diffNameMap[w.difficulty] || ''} · ${w.type === 'spell' ? '拼写题' : '选择题'}</span>
                  </div>
                  <div style="font-size: 0.85rem; color: var(--accent);">正确：${w.correct}</div>
                  <div style="font-size: 0.85rem; color: var(--danger);">你的答案：${w.selected}</div>
                </div>
              `).join('')}
            </div>
          </details>
          ` : `<div style="color: var(--accent); margin-bottom: 1rem;">${Icon.trophy} 全部正确！</div>`}

          <!-- 操作按钮 -->
          <div class="flex gap-1" style="justify-content: center;">
            <button class="btn btn-primary" onclick="VocabTestModule.start()">再测一次</button>
            <button class="btn btn-secondary" onclick="navigate('challenge')">去挑战</button>
            <button class="btn btn-ghost" onclick="navigate('home')">返回首页</button>
          </div>
        </div>
      </div>
    `;

    showToast(`检测完成！预估词汇量约 ${estimatedVocab}，推荐难度：${difficultyNames[recommendedDifficulty]}`, 'success');
    // 初始化动态生成的图标
    if (window.initIcons) initIcons();

    // 异步调用 AI 综合评分（4 个难度表现 → 综合评价）
    this._fetchAIEvaluation();
  },

  /**
   * 调用 AI 进行综合评分
   * 根据用户在 4 个难度中的表现给出综合评价
   */
  async _fetchAIEvaluation() {
    const container = document.getElementById('vocab-ai-eval');
    if (!container) return;

    // AI 未配置时给出降级提示
    if (!window.aiService || !aiService.isConfigured()) {
      container.innerHTML = `
        <div style="background: var(--bg-secondary); border-radius: var(--radius); padding: 0.75rem 1rem; font-size: 0.85rem; color: var(--text-muted); text-align: center;">
          ${Icon.hint} AI 服务未配置，无法生成综合评分
        </div>
      `;
      if (window.initIcons) initIcons();
      return;
    }

    // 展示加载中状态
    container.innerHTML = `
      <div style="background: rgba(33,150,243,0.06); border: 1px solid rgba(33,150,243,0.2); border-radius: var(--radius); padding: 1rem; font-size: 0.9rem; color: var(--info); text-align: center;">
        ${Icon.ai} AI 正在综合分析你的测试表现...
      </div>
    `;
    if (window.initIcons) initIcons();

    const sb = this._correctByDifficulty;
    // 组装 AI 评分 prompt（按指定格式）
    const prompt =
      '请根据以下词汇测试结果给出评价：\n' +
      `小白难度：${sb.beginner || 0}/10 正确\n` +
      `普通难度：${sb.normal || 0}/10 正确\n` +
      `中等难度：${sb.medium || 0}/10 正确\n` +
      `地狱难度：${sb.hell || 0}/10 正确\n` +
      '请给出综合评价（包括词汇水平等级、总体表现描述），2-3句话即可。\n' +
      '格式（严格JSON）：{"overall": "综合评价"}';

    const messages = [
      { role: 'system', content: '你是一位资深的英语词汇教学专家，擅长根据词汇测试结果给出专业、中肯的综合评价。回答必须为严格的 JSON 格式，不要输出多余内容。' },
      { role: 'user', content: prompt },
    ];

    try {
      const text = await aiService._callWorker(messages, 0.7, 600);
      const result = parseAIResponse(text);
      if (!result || !result.overall) {
        throw new Error('AI 返回格式不正确');
      }
      this._aiEvaluation = result;
      this._renderAIEvaluation(container, result);
    } catch (e) {
      console.error('[VocabTestModule] AI 综合评分失败:', e);
      container.innerHTML = `
        <div style="background: rgba(244,67,54,0.06); border: 1px solid rgba(244,67,54,0.2); border-radius: var(--radius); padding: 0.75rem 1rem; font-size: 0.85rem; color: var(--danger); text-align: center;">
          ${Icon.wrong} AI 评分失败：${e.message}
        </div>
        <div style="text-align: center; margin-top: 0.5rem;">
          <button class="btn btn-ghost btn-sm" onclick="VocabTestModule._fetchAIEvaluation()">${Icon.refresh} 重新生成</button>
        </div>
      `;
      if (window.initIcons) initIcons();
    }
  },

  /**
   * 渲染 AI 综合评分结果
   * @param {HTMLElement} container - 容器元素
   * @param {Object} result - { overall }
   */
  _renderAIEvaluation(container, result) {
    const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
    container.innerHTML = `
      <div style="background: rgba(108,92,231,0.06); border: 1px solid rgba(108,92,231,0.25); border-radius: var(--radius); padding: 1rem; text-align: left;">
        <div style="display: flex; align-items: center; gap: 0.4rem; font-size: 1rem; font-weight: 600; color: var(--accent); margin-bottom: 0.6rem;">
          ${Icon.ai} AI 综合评价
        </div>
        <div style="font-size: 0.9rem; color: var(--text-primary); line-height: 1.5;">${escapeHtml(result.overall)}</div>
        <div style="text-align: right; margin-top: 0.5rem;">
          <button class="btn btn-ghost btn-sm" onclick="VocabTestModule._fetchAIEvaluation()">${Icon.refresh} 重新生成</button>
        </div>
      </div>
    `;
    if (window.initIcons) initIcons();
  },

  /**
   * 取消检测
   */
  cancel() {
    this._words = [];
    this._questionTypes = [];
    this._difficultyOf = [];
    this._currentIndex = 0;
    this._correct = 0;
    this._wrongWords = [];
    this._options = [];
    this._answered = false;
    this._testStartTime = 0;
    this._correctByDifficulty = { beginner: 0, normal: 0, medium: 0, hell: 0 };
    this._aiEvaluation = null;
    renderHome();
  },
};

/* ===========================
   辅助函数
   =========================== */

/**
 * 显示/隐藏全局加载动画
 * @param {boolean} show - 是否显示
 */
function showLoading(show) {
  let loader = document.getElementById('global-loader');
  if (!loader) {
    loader = document.createElement('div');
    loader.id = 'global-loader';
    loader.className = 'loading-spinner';
    loader.innerHTML = `
      <div class="spinner"></div>
      <div class="loading-text">加载中...</div>
    `;
    document.querySelector('.main-content')?.prepend(loader);
  }
  loader.style.display = show ? 'flex' : 'none';
}

/* ===========================
   页面就绪后初始化
   =========================== */
document.addEventListener('DOMContentLoaded', init);

/* ===========================
   导出所有函数到全局作用域
   使 HTML 中的 onclick 等内联事件能调用到这些函数
   =========================== */
window.AppState = AppState;
window.init = init;
window.handleRouteChange = handleRouteChange;
window.navigate = navigate;
window.restoreSettings = restoreSettings;
window.toggleDarkMode = toggleDarkMode;
window.toggleSettings = toggleSettings;
window.syncSettingsUI = syncSettingsUI;
window.updateBatchSize = updateBatchSize;
window.updateVoiceRate = updateVoiceRate;
window.updateSpellMode = updateSpellMode;
window.updateWorkerUrl = updateWorkerUrl;
window.confirmClearProgress = confirmClearProgress;
window.confirmClearCache = confirmClearCache;
window.renderHome = renderHome;
window.renderLearn = renderLearn;
window.renderSpell = renderSpell;
window.renderChallenge = renderChallenge;
window.startReview = startReview;
window.startNewBatch = startNewBatch;
window.speakWord = speakWord;
window.startSpellTraining = startSpellTraining;
window.startChallenge = startChallenge;
window.onChallengeBookChange = onChallengeBookChange;
window.ChallengeModule = ChallengeModule;
window.VocabTestModule = VocabTestModule;
window.getRecommendedDifficulty = getRecommendedDifficulty;
window.SpellModule = SpellModule;
window.showLoading = showLoading;
// 拼写训练
window.startSpellTrainingV2 = startSpellTrainingV2;
window.onSpellModeChange = onSpellModeChange;
window.onSpellRangeChange = onSpellRangeChange;
window.onSpellBookChange = onSpellBookChange;
// 学习流程
window.nextStudyWord = nextStudyWord;
window.prevStudyWord = prevStudyWord;
window.regenerateExample = regenerateExample;
window.generateExampleNow = generateExampleNow;
window.exitLearnFlow = exitLearnFlow;
window.startSingleWordLearn = startSingleWordLearn;
window.learnWordFromList = learnWordFromList;
window.onLearnBookChange = onLearnBookChange;
window.startLearnFromSource = startLearnFromSource;
window.enterSpellFromLearn = enterSpellFromLearn;
// 单词表页面
window.renderWordList = renderWordList;
window.renderWordlistUnits = renderWordlistUnits;
window.switchWordlistBook = switchWordlistBook;
window.toggleUnitExpand = toggleUnitExpand;
window.navigateToWordlistUnit = navigateToWordlistUnit;
// 已学单词页面
window.renderLearnedWords = renderLearnedWords;
window.renderLearnedWordsList = renderLearnedWordsList;
window.filterLearnedWords = filterLearnedWords;
// 快速查词页面
window.renderSearch = renderSearch;
window.performSearch = performSearch;
// 教材服务
window.textbookService = textbookService;
