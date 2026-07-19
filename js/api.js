/**
 * API 客户端：直接调用 Gitee API
 * 
 * 安全说明：
 * - 令牌放在 js/config.js 里，会暴露给用户
 * - 仅适用于小范围熟人使用场景
 * - 密码用 SHA-256 加盐哈希，即使令牌泄露也拿不到明文密码
 * - 令牌权限只给 projects，限制在数据仓库
 */
const ApiClient = {
  /**
   * 发送请求到 Gitee API
   * @param {string} method - HTTP 方法 GET/POST/PUT/DELETE
   * @param {string} path - 文件路径，如 "users/zhangsan.json"
   * @param {object} extra - 额外的请求体参数（POST/PUT 时）
   * @returns {Promise<object>} 响应数据
   */
  async _request(method, path, extra = {}) {
    const url = `${SITE_CONFIG.GITEE_API_BASE}/${path}`;
    
    // GET 请求：参数放 query string
    if (method === 'GET') {
      const fullUrl = `${url}?ref=${SITE_CONFIG.GITEE_BRANCH}&access_token=${SITE_CONFIG.GITEE_TOKEN}`;
      const resp = await fetch(fullUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (resp.status === 404) return null;
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(this._formatError(resp.status, errText));
      }
      return await resp.json();
    }
    
    // POST/PUT/DELETE 请求：参数放 body
    const body = {
      access_token: SITE_CONFIG.GITEE_TOKEN,
      branch: SITE_CONFIG.GITEE_BRANCH,
      ...extra,
    };
    
    const resp = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify(body),
    });
    
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(this._formatError(resp.status, errText));
    }
    
    return await resp.json();
  },

  /**
   * 格式化错误信息
   */
  _formatError(status, errText) {
    let msg = `请求失败 (${status})`;
    try {
      const errObj = JSON.parse(errText);
      if (errObj.message) msg = errObj.message;
    } catch (e) {
      if (errText) msg = errText.substring(0, 100);
    }
    
    // 友好化常见错误
    if (status === 0 || msg.includes('Failed to fetch')) {
      return '网络连接失败，请检查网络后重试';
    }
    if (status === 401) {
      return '认证失败，请联系管理员';
    }
    if (status === 403) {
      return '权限不足，可能令牌已失效';
    }
    if (status === 404) {
      return '资源不存在';
    }
    if (status === 409) {
      return '资源已存在';
    }
    if (status === 422) {
      // Gitee 文件已存在时返回 422
      if (msg.includes('already exists') || msg.includes('已存在')) {
        return '资源已存在';
      }
    }
    return msg;
  },

  /**
   * Base64 编码（支持 UTF-8 中文）
   */
  _base64Encode(str) {
    // 先 UTF-8 编码，再 Base64
    return btoa(unescape(encodeURIComponent(str)));
  },

  /**
   * Base64 解码（支持 UTF-8 中文）
   */
  _base64Decode(b64) {
    return decodeURIComponent(escape(atob(b64)));
  },

  // ============ 文件操作 ============

  /**
   * 读取文件
   * @param {string} filePath - 文件路径
   * @returns {Promise<object|null>} { content, sha } 或 null（不存在）
   */
  async readFile(filePath) {
    const data = await this._request('GET', filePath);
    // Gitee API 对不存在的文件返回空数组 []（200状态码），而不是 404
    if (!data || (Array.isArray(data) && data.length === 0)) return null;
    // 如果返回的是数组（目录），也不是文件
    if (Array.isArray(data)) return null;
    const content = this._base64Decode(data.content.replace(/\n/g, ''));
    return { content: JSON.parse(content), sha: data.sha };
  },

  /**
   * 创建文件
   * @param {string} filePath - 文件路径
   * @param {object} contentObj - 要存储的对象
   */
  async createFile(filePath, contentObj) {
    const content = this._base64Encode(JSON.stringify(contentObj, null, 2));
    return await this._request('POST', filePath, {
      content: content,
      message: `create: ${filePath}`,
    });
  },

  /**
   * 更新文件
   * @param {string} filePath - 文件路径
   * @param {object} contentObj - 要存储的对象
   * @param {string} sha - 文件的 SHA 值
   */
  async updateFile(filePath, contentObj, sha) {
    const content = this._base64Encode(JSON.stringify(contentObj, null, 2));
    return await this._request('PUT', filePath, {
      content: content,
      sha: sha,
      message: `update: ${filePath}`,
    });
  },

  /**
   * 创建或更新文件（自动判断）
   * @param {string} filePath - 文件路径
   * @param {object} contentObj - 要存储的对象
   */
  async upsertFile(filePath, contentObj) {
    const existing = await this.readFile(filePath);
    if (existing === null) {
      return await this.createFile(filePath, contentObj);
    } else {
      return await this.updateFile(filePath, contentObj, existing.sha);
    }
  },

  // ============ 业务接口 ============

  /**
   * 健康检查（测试 Gitee API 连通性）
   */
  async health() {
    try {
      // 尝试读取仓库根目录
      const url = `https://gitee.com/api/v5/repos/${SITE_CONFIG.GITEE_OWNER}/${SITE_CONFIG.GITEE_REPO}`;
      const resp = await fetch(`${url}?access_token=${SITE_CONFIG.GITEE_TOKEN}`);
      if (!resp.ok) {
        throw new Error(`Gitee API 返回 ${resp.status}`);
      }
      const data = await resp.json();
      return { ok: true, message: `连接正常，仓库: ${data.full_name}` };
    } catch (e) {
      throw new Error('Gitee API 连接失败: ' + e.message);
    }
  },

  /**
   * 密码哈希（SHA-256）
   * 盐 = 用户名，无需额外存储
   * @param {string} password - 明文密码
   * @param {string} username - 用户名（作为盐）
   * @returns {Promise<string>} 哈希值的十六进制字符串
   */
  async hashPassword(password, username) {
    const salted = password + ':' + username.toLowerCase();
    const encoder = new TextEncoder();
    const data = encoder.encode(salted);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  },

  /**
   * 验证用户名格式（只允许字母数字下划线，3-20字符）
   */
  validateUsername(username) {
    if (!username || typeof username !== 'string') return false;
    return /^[a-zA-Z0-9_]{3,20}$/.test(username);
  },

  /**
   * 验证密码长度（至少6位）
   */
  validatePassword(password) {
    if (!password || typeof password !== 'string') return false;
    return password.length >= 6;
  },

  /**
   * 注册新用户
   * @param {string} username - 用户名
   * @param {string} password - 密码
   * @returns {Promise<object>} { ok, user }
   */
  async register(username, password) {
    if (!this.validateUsername(username)) {
      throw new Error('用户名需3-20位字母、数字或下划线');
    }
    if (!this.validatePassword(password)) {
      throw new Error('密码至少6位');
    }

    // 1. 检查用户是否已存在
    const userPath = `users/${username}.json`;
    const existing = await this.readFile(userPath);
    if (existing !== null) {
      throw new Error('用户名已被占用');
    }

    // 2. 哈希密码
    const passwordHash = await this.hashPassword(password, username);

    // 3. 创建用户文件
    const userData = {
      username: username,
      nickname: username,
      passwordHash: passwordHash,
      createdAt: new Date().toISOString(),
    };
    await this.createFile(userPath, userData);

    // 4. 创建空的进度文件
    const progressPath = `data/${username}_progress.json`;
    const emptyProgress = {
      username: username,
      learned: {},
      stats: {
        totalLearned: 0,
        totalMastered: 0,
        streakDays: 0,
        lastStudyDate: null,
      },
      updatedAt: new Date().toISOString(),
    };
    await this.createFile(progressPath, emptyProgress);

    return {
      ok: true,
      message: '注册成功',
      user: { username: username, nickname: username },
    };
  },

  /**
   * 登录
   * @param {string} username - 用户名
   * @param {string} password - 密码
   * @returns {Promise<object>} { ok, user }
   */
  async login(username, password) {
    if (!this.validateUsername(username) || !this.validatePassword(password)) {
      throw new Error('用户名或密码错误');
    }

    // 1. 读取用户文件
    const userPath = `users/${username}.json`;
    const result = await this.readFile(userPath);
    if (result === null) {
      throw new Error('用户名或密码错误');
    }

    const user = result.content;
    
    // 2. 比对密码哈希
    const passwordHash = await this.hashPassword(password, username);
    if (passwordHash !== user.passwordHash) {
      throw new Error('用户名或密码错误');
    }

    return {
      ok: true,
      message: '登录成功',
      user: {
        username: user.username,
        nickname: user.nickname || user.username,
      },
    };
  },

  /**
   * 读取学习数据
   * @param {string} username - 用户名
   * @returns {Promise<object>} 学习数据
   */
  async readData(username) {
    const progressPath = `data/${username}_progress.json`;
    const result = await this.readFile(progressPath);
    if (result === null) {
      throw new Error('用户数据不存在');
    }
    return { ok: true, data: result.content };
  },

  /**
   * 保存学习数据
   * @param {string} username - 用户名
   * @param {object} data - 学习数据
   * @returns {Promise<object>}
   */
  async saveData(username, data) {
    const progressPath = `data/${username}_progress.json`;
    data.username = username;
    data.updatedAt = new Date().toISOString();
    await this.upsertFile(progressPath, data);
    return { ok: true, message: '保存成功', updatedAt: data.updatedAt };
  },
};
