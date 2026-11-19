const params = new URLSearchParams(location.search);
const ticket = params.get('ticket') || '';
const appKey = params.get('app') || '';
const title = document.getElementById('launch-title');
const desc = document.getElementById('launch-desc');

async function main() {
  if (!ticket) {
    title.textContent = '请从 App 打开';
    desc.textContent = '这个小程序需要在集市 App 内打开。';
    return;
  }
  try {
    const res = await fetch('/v1/sessions/exchange', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || '会话建立失败');
    title.textContent = data.app?.name || '小程序已启动';
    desc.textContent = '正在进入…';
    // 网关模式：会话建立后跳到小程序自己的 entryURL；演示应用则进入内置容器页
    const entry = data.app?.entryURL || '';
    if (entry && !entry.startsWith(location.origin)) {
      location.replace(entry);
      return;
    }
    const target = appKey ? `app=${encodeURIComponent(appKey)}` : `app=${encodeURIComponent(data.session.appKey)}`;
    location.replace(`/demo/app?${target}`);
  } catch (err) {
    title.textContent = '打开失败';
    desc.textContent = err.message || '打开失败，请返回 App 重试。';
  }
}

main();