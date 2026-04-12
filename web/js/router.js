import { $, $$ } from './utils/dom.js';

const routes = ['files', 'settings'];

function navigate(route) {
  if (!routes.includes(route)) route = 'files';

  $$('.page').forEach(p => p.classList.toggle('active', p.dataset.page === route));
  $$('[data-nav]').forEach(n => n.classList.toggle('active', n.dataset.nav === route));
}

export function initRouter() {
  const hash = window.location.hash.slice(1) || 'files';
  navigate(hash);

  window.addEventListener('hashchange', () => {
    navigate(window.location.hash.slice(1) || 'files');
  });

  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-nav]');
    if (link) {
      e.preventDefault();
      window.location.hash = link.dataset.nav;
    }
  });
}
