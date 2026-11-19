import { state } from './state.js';
import { icon } from './ui.js';
import { shell, setContent } from './console-shell.js';
import { docsHtml } from './docs.js';

export function renderDocs() {
  shell('docs', '开发文档');
  setContent(`<div class="card card-pad doc-shell">${docsHtml(location.origin)}</div>`);
}

export function renderDocsPublic() {
  document.getElementById('app').innerHTML = `
  <div style="min-height:100vh;background:var(--bg)">
    <header class="site-header">
      <div class="header-inner">
        <a class="brand" href="/">
          <img class="brand-logo" src="/assets/logo.png" alt="" /><span>集市小程序开放平台</span>
        </a>
        <nav class="nav-links">
          <a href="/">首页</a>
          <a href="/#/docs">文档</a>
          ${state.me ? '<a class="btn btn-primary btn-sm" href="#/dashboard">控制台</a>' : '<a class="btn btn-ghost btn-sm" href="#/login">登录</a><a class="btn btn-primary btn-sm" href="#/register">注册</a>'}
        </nav>
      </div>
    </header>
    <main style="max-width:1100px;margin:0 auto;padding:16px 24px 70px">
      <div class="card card-pad doc-shell">${docsHtml(location.origin)}</div>
    </main>
  </div>`;
}