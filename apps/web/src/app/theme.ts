export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'smart-todo-theme';

export const themeScript = `
  try {
    var theme = window.localStorage.getItem('${THEME_STORAGE_KEY}');
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  } catch {
    document.documentElement.dataset.theme = 'light';
  }
`;
