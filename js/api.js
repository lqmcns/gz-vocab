/**
 * API 客户端：与 Cloudflare Worker 通信
 * 所有网络请求都通过 Worker 中转，保护 Gitee 令牌安全
 */
const ApiClient = {
  // Worker URL（不带末尾斜杠）
  BASE_URL: 'https://vocab-api.2943597644.workers.dev',

  /**
   * 发送 POST 请求
   * @param {string} path - 接口路径，如 '/api/login'
   * @param {object} data - 请求体数据
   * @returns {Promise<object>} 响应数据
   */
  async post(path, data) {
    try {
      const resp = await fetch(this.BASE_URL + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await resp.json();
      if (!resp.ok) {
        throw new Error(result.error || '请求失败');
      }
      return result;
    } catch (e) {
      // 网络错误或 JSON 解析失败
      throw new Error(this._formatError(e));
    }
  },

  /**
   * 发送 GET 请求
   * @param {string} path - 接口路径，如 '/api/data?username=xxx'
   * @returns {Promise<object>} 响应数据
   */
  async get(path) {
    try {
      const resp = await fetch(this.BASE_URL + path, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const result = await resp.json();
      if (!resp.ok) {
        throw new Error(result.error || '请求失败');
      }
      return result;
    } catch (e) {
      throw new Error(this._formatError(e));
    }
  },

  /**
   * 格式化错误信息
   */
  _formatError(e) {
    const msg = e.message || String(e);
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      return '网络连接失败，请检查网络后重试';
    }
    return msg;
  },

  // ============ 业务接口 ============

  /**
   * 健康检查
   */
  async health() {
    return this.get('/api/health');
  },

  /**
   * 注册
   * @param {string} username - 用户名（3-20位字母数字下划线）
   * @param {string} password - 密码（至少6位）
   */
  async register(username, password) {
    return this.post('/api/register', { username, password });
  },

  /**
   * 登录
   * @param {string} username - 用户名
   * @param {string} password - 密码
   */
  async login(username, password) {
    return this.post('/api/login', { username, password });
  },

  /**
   * 读取学习数据
   * @param {string} username - 用户名
   */
  async readData(username) {
    return this.get('/api/data?username=' + encodeURIComponent(username));
  },

  /**
   * 保存学习数据
   * @param {string} username - 用户名
   * @param {object} data - 学习数据
   */
  async saveData(username, data) {
    return this.post('/api/data', { username, data });
  },
};
