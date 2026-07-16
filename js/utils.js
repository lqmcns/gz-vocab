/**
 * utils.js - 工具函数库
 * 提供通用的辅助函数，供所有模块使用
 */

/* ===========================
   Fisher-Yates 洗牌算法
   原地打乱数组，返回打乱后的数组
   =========================== */
function shuffleArray(arr) {
  const shuffled = [...arr]; // 不修改原数组
  for (let i = shuffled.length - 1; i > 0; i--) {
    // 生成 [0, i] 范围内的随机整数
    const j = Math.floor(Math.random() * (i + 1));
    // 交换元素
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/* ===========================
   随机取 n 个不重复元素
   =========================== */
function randomPick(arr, n) {
  if (n >= arr.length) {
    return shuffleArray([...arr]);
  }
  // 使用洗牌后取前 n 个，保证不重复
  return shuffleArray([...arr]).slice(0, n);
}

/* ===========================
   多层容错 JSON 解析
   用于解析 AI 返回的文本中提取 JSON 数据
   策略：直接解析 -> 提取 JSON 代码块 -> 提取花括号
   =========================== */
function parseAIResponse(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  // 第一层：直接尝试解析
  try {
    const result = JSON.parse(text.trim());
    return result;
  } catch (e) {
    // 继续尝试
  }

  // 第二层：提取 ```json ... ``` 或 ``` ... ``` 代码块中的内容
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/;
  const codeBlockMatch = text.match(codeBlockRegex);
  if (codeBlockMatch) {
    try {
      const result = JSON.parse(codeBlockMatch[1].trim());
      return result;
    } catch (e) {
      // 继续尝试
    }
  }

  // 第三层：提取最外层的花括号 { ... } 或方括号 [ ... ]
  const braceRegex = /(\{[\s\S]*\}|\[[\s\S]*\])/;
  const braceMatch = text.match(braceRegex);
  if (braceMatch) {
    try {
      const result = JSON.parse(braceMatch[1].trim());
      return result;
    } catch (e) {
      // 解析失败
    }
  }

  // 所有尝试均失败
  console.warn('[parseAIResponse] 无法解析文本为 JSON:', text.substring(0, 200));
  return null;
}

/* ===========================
   防抖函数
   延迟执行，在指定时间内只执行最后一次调用
   =========================== */
function debounce(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    // 每次调用时清除之前的定时器
    if (timer) {
      clearTimeout(timer);
    }
    // 设置新的定时器
    timer = setTimeout(() => {
      fn.apply(this, args);
      timer = null;
    }, delay);
  };
}

/* ===========================
   Toast 提示
   在页面右上角弹出提示消息
   @param {string} message - 提示文字
   @param {'success'|'error'|'info'} type - 提示类型
   =========================== */
function showToast(message, type = 'info') {
  // 确保 toast 容器存在
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  // 图标映射
  const icons = {
    success: '\u2714', // ✔
    error: '\u2716',   // ✖
    info: '\u2139',    // ℹ
  };

  // 创建 toast 元素
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span>${message}</span>
  `;

  // 添加到容器
  container.appendChild(toast);

  // 3 秒后自动移除
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 3000);
}

/* ===========================
   格式化词性字符串
   将 "v:90/n:10" 格式转换为 "v. / n." 的可读格式
   @param {string} posStr - 词性比例字符串，如 "v:90/n:10"
   @returns {string} 格式化后的词性字符串
   =========================== */
function formatPos(posStr) {
  if (!posStr || typeof posStr !== 'string') {
    return '';
  }

  // 按斜杠分割各词性项
  const parts = posStr.split('/');
  const formatted = parts.map((part) => {
    // 去除比例数字，只保留词性字母
    const pos = part.split(':')[0].trim();
    // 词性映射表
    const posMap = {
      n: 'n.',    // 名词
      v: 'v.',    // 动词
      adj: 'adj.', // 形容词
      adv: 'adv.', // 副词
      prep: 'prep.', // 介词
      conj: 'conj.', // 连词
      pron: 'pron.', // 代词
      det: 'det.', // 限定词
      int: 'int.', // 感叹词
      aux: 'aux.', // 助动词
      art: 'art.', // 冠词
      num: 'num.', // 数词
      abbr: 'abbr.', // 缩写
    };
    return posMap[pos] || pos + '.';
  });

  return formatted.join(' / ');
}

/* ===========================
   导出为全局可用
   在非模块环境中挂载到 window
   =========================== */
window.utils = {
  shuffleArray,
  randomPick,
  parseAIResponse,
  debounce,
  showToast,
  formatPos,
};
