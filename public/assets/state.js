export const state = {
  me: null,
  apps: [],
  categories: [
    { key: 'content', name: '内容' }, { key: 'tool', name: '工具' }, { key: 'life', name: '生活' },
    { key: 'official', name: '官方' }, { key: 'game', name: '游戏' }, { key: 'shopping', name: '购物' },
    { key: 'other', name: '其他' },
  ],
  scopes: ['profile:read', 'prefs:read', 'prefs:write', 'notifications:read', 'notifications:write', 'posts:read'],
  filter: { status: 'all', q: '' },
  detail: null,
  docTab: 'dart',
  stats: null,
  audit: null,
};