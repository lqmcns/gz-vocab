/**
 * 用户认证管理
 * 处理登录、注册、登出、会话保持
 * 登录状态保存在 localStorage，同一设备保持登录
 */
const AuthService = {
  // localStorage 键名
  SESSION_KEY: 'vocab-session',
  // 内存中的当前用户
  _currentUser: null,

  /**
   * 初始化：从 localStorage 恢复登录状态
   */
  init() {
    try {
      const saved = localStorage.getItem(this.SESSION_KEY);
      if (saved) {
        const session = JSON.parse(saved);
        // 简单验证 session 结构
        if (session && session.username && session.nickname) {
          this._currentUser = session;
          console.log('[Auth] 恢复登录状态:', session.username);
        }
      }
    } catch (e) {
      console.warn('[Auth] 恢复登录状态失败:', e);
      localStorage.removeItem(this.SESSION_KEY);
    }
  },

  /**
   * 当前是否已登录
   * @returns {boolean}
   */
  isLoggedIn() {
    return this._currentUser !== null;
  },

  /**
   * 获取当前用户信息
   * @returns {object|null} { username, nickname }
   */
  getCurrentUser() {
    return this._currentUser;
  },

  /**
   * 获取当前用户名
   * @returns {string|null}
   */
  getUsername() {
    return this._currentUser ? this._currentUser.username : null;
  },

  /**
   * 获取当前昵称
   * @returns {string|null}
   */
  getNickname() {
    return this._currentUser ? this._currentUser.nickname : null;
  },

  /**
   * 注册新用户
   * @param {string} username - 用户名
   * @param {string} password - 密码
   * @returns {Promise<object>} { ok, user }
   */
  async register(username, password) {
    // 前端预校验
    if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      throw new Error('用户名需3-20位字母、数字或下划线');
    }
    if (!password || password.length < 6) {
      throw new Error('密码至少6位');
    }

    const result = await ApiClient.register(username, password);

    // 注册成功后自动登录
    this._setSession({
      username: result.user.username,
      nickname: result.user.nickname,
    });

    return result;
  },

  /**
   * 登录
   * @param {string} username - 用户名
   * @param {string} password - 密码
   * @returns {Promise<object>} { ok, user }
   */
  async login(username, password) {
    if (!username || !password) {
      throw new Error('请输入用户名和密码');
    }

    const result = await ApiClient.login(username, password);

    this._setSession({
      username: result.user.username,
      nickname: result.user.nickname,
    });

    return result;
  },

  /**
   * 退出登录
   */
  logout() {
    this._currentUser = null;
    localStorage.removeItem(this.SESSION_KEY);
    console.log('[Auth] 已退出登录');
  },

  /**
   * 保存登录状态到 localStorage
   */
  _setSession(user) {
    this._currentUser = user;
    localStorage.setItem(this.SESSION_KEY, JSON.stringify(user));
    console.log('[Auth] 登录成功:', user.username);
  },

  /**
   * 确保已登录，未登录则弹出登录框
   * @returns {boolean} 是否已登录
   */
  requireLogin() {
    if (this.isLoggedIn()) {
      return true;
    }
    // 弹出登录框
    if (typeof showAuthModal === 'function') {
      showAuthModal('login');
    }
    return false;
  },

  /**
   * 从云端加载学习数据
   * @returns {Promise<object|null>} 学习数据
   */
  async loadCloudData() {
    if (!this.isLoggedIn()) return null;
    try {
      const result = await ApiClient.readData(this._currentUser.username);
      return result.data;
    } catch (e) {
      console.warn('[Auth] 加载云端数据失败:', e);
      return null;
    }
  },

  /**
   * 保存学习数据到云端
   * @param {object} data - 学习数据
   * @returns {Promise<boolean>} 是否成功
   */
  async saveCloudData(data) {
    if (!this.isLoggedIn()) return false;
    try {
      await ApiClient.saveData(this._currentUser.username, data);
      return true;
    } catch (e) {
      console.warn('[Auth] 保存云端数据失败:', e);
      return false;
    }
  },
};

// 页面加载时初始化
if (typeof window !== 'undefined') {
  // 确保在 DOM 就绪后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => AuthService.init());
  } else {
    AuthService.init();
  }
}
