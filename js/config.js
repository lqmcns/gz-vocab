/**
 * 网站配置文件
 * 
 * ⚠️ 安全警告：
 * 此文件包含 Gitee 私人令牌，会随网站代码一起暴露给用户。
 * 仅适用于小范围使用场景（用户都是不懂技术的熟人）。
 * 
 * 令牌权限：只授权 projects（仓库读写），不授权其他权限
 * 令牌归属：建议使用专用小号的令牌，不使用主账号
 * 
 * 如果令牌泄露：去 Gitee 设置里撤销此令牌，生成新令牌后更新下面的 GITEE_TOKEN
 */
const SITE_CONFIG = {
  // 应用版本号（每次更新后手动修改）
  APP_VERSION: '2.1.0',

  // Gitee 仓库配置
  GITEE_OWNER: 'northsey',
  GITEE_REPO: 'gaozhong--vocab-database',
  GITEE_BRANCH: 'master',
  
  // Gitee 私人令牌（只读权限建议用小号生成）
  // ⚠️ 此令牌会暴露在前端代码中，仅限熟人小范围使用
  GITEE_TOKEN: '07854420f21070a7d0a11e83661df5d2',
  
  // Gitee API 基础 URL
  get GITEE_API_BASE() {
    return `https://gitee.com/api/v5/repos/${this.GITEE_OWNER}/${this.GITEE_REPO}/contents`;
  },
};

// 冻结对象，防止运行时被篡改
if (typeof Object !== 'undefined' && Object.freeze) {
  Object.freeze(SITE_CONFIG);
}
