import { state } from './state.js';
import { icon, esc, fmtDate } from './ui.js';
import { shell, setContent, pageHead } from './console-shell.js';

export function renderAccount() {
  shell('account', '账号设置');
  const me = state.me || {};
  setContent(`
    ${pageHead('账号设置', '管理开发者资料与登录安全。')}
    <div class="grid" style="grid-template-columns:1.4fr 1fr;align-items:start">
      <div class="stack">
        <form class="card card-pad form-grid" data-form="account-profile" novalidate>
          <div class="row" style="margin-bottom:4px">
            <div class="avatar avatar-lg ${me.avatarUrl ? 'has-img' : ''}" data-initial="${esc((me.displayName || me.email || 'D').slice(0, 1).toUpperCase())}">${me.avatarUrl ? `<img src="${esc(me.avatarUrl)}" alt="" referrerpolicy="no-referrer" />` : esc((me.displayName || me.email || 'D').slice(0, 1).toUpperCase())}</div>
            <div class="grow"><b>${esc(me.displayName || '开发者')}</b><div class="muted small">${esc(me.email || '')}</div></div>
          </div>
          <div class="between" style="margin-bottom:2px">
            <h3 style="font-size:15px">基本资料</h3>
            <span class="pill ${me.role === 'admin' ? 'approved' : 'draft'}">${me.role === 'admin' ? '平台管理员' : '开发者'}</span>
          </div>
          <div class="field"><label>邮箱</label><input class="input" value="${esc(me.email || '')}" disabled /></div>
          <div class="grid grid-2">
            <div class="field"><label>称呼</label><input class="input" name="displayName" value="${esc(me.displayName || '')}" maxlength="32" /></div>
            <div class="field"><label>团队 / 组织</label><input class="input" name="orgName" value="${esc(me.orgName || '')}" maxlength="64" /></div>
          </div>
          <div class="field"><label>联系电话</label><input class="input" name="phone" value="${esc(me.phone || '')}" maxlength="32" placeholder="选填，便于审核联系" /></div>
          <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" type="submit">保存资料</button></div>
        </form>

        ${me.authSource === 'sso'
          ? `<div class="card card-pad">
               <h3 style="font-size:15px">登录方式</h3>
               <p class="muted small" style="line-height:1.8;margin-top:6px">当前使用学校统一身份登录，无需单独设置密码。退出后重新登录会继续使用统一身份认证。</p>
             </div>`
          : `        <form class="card card-pad form-grid" data-form="account-password" novalidate>
          <h3 style="font-size:15px">修改密码</h3>
          <div class="field"><label>当前密码</label><input class="input" type="password" name="currentPassword" autocomplete="current-password" required /></div>
          <div class="grid grid-2">
            <div class="field"><label>新密码</label><input class="input" type="password" name="newPassword" minlength="8" autocomplete="new-password" required /></div>
            <div class="field"><label>确认新密码</label><input class="input" type="password" name="confirmPassword" minlength="8" autocomplete="new-password" required /></div>
          </div>
          <div class="alert alert-info">${icon('shield', 15)}<span>修改密码后其他设备的登录状态会立即失效。</span></div>
          <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" type="submit">更新密码</button></div>
        </form>
`}
      </div>

      <aside class="stack">
        <div class="card card-pad">
          <h3 style="font-size:14px;margin-bottom:12px">账号信息</h3>
          <div class="kv"><span class="k">注册时间</span><span class="v">${fmtDate(me.createdAt)}</span></div>
          <div class="kv"><span class="k">最近登录</span><span class="v">${me.lastLoginAt ? fmtDate(me.lastLoginAt) : '—'}</span></div>
          <div class="kv"><span class="k">邮箱验证</span><span class="v">${me.emailVerified ? '已验证' : '未验证'}</span></div>
          <div class="kv"><span class="k">登录方式</span><span class="v">${esc(me.authSourceLabel || '邮箱密码')}</span></div>
          <div class="kv"><span class="k">账号状态</span><span class="v">${me.status === 'active' ? '正常' : '已停用'}</span></div>
        </div>
        <div class="card card-pad">
          <h3 style="font-size:14px;margin-bottom:8px">安全提示</h3>
          <p class="muted small" style="line-height:1.8">开放平台账号可以发布小程序、读取用户授权。请开启唯一密码，不要在公共设备上保持登录。</p>
        </div>
        <div class="card card-pad">
          <h3 style="font-size:14px;margin-bottom:8px">需要帮助？</h3>
          <p class="muted small" style="line-height:1.8">审核规则、接口问题可查看开发文档，或在 App 内提交反馈。</p>
          <a class="btn btn-soft btn-sm" style="width:100%;margin-top:10px" href="#/docs">${icon('book', 15)} 开发文档</a>
        </div>
      </aside>
    </div>`);
}