let openMenu = null;

export function createKebabMenuButton(items){
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn subtle kebab-btn';
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  btn.title = 'More options';
  btn.textContent = '⋮';

  const menu = document.createElement('div');
  menu.className = 'menu hidden';
  items.forEach(it => {
    const mi = document.createElement('button');
    mi.type = 'button';
    mi.className = 'menu__item';
    mi.textContent = it.label;
    if (it.disabled) mi.disabled = true;
    mi.addEventListener('click', (e) => {
      e.stopPropagation();
      hideMenu();
      if (typeof it.onClick === 'function' && !mi.disabled) it.onClick();
    });
    menu.appendChild(mi);
  });

  function hideMenu(){
    if (openMenu && openMenu !== menu) {
      openMenu.classList.add('hidden');
      openMenu.anchor?.setAttribute('aria-expanded', 'false');
      openMenu = null;
    }
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  }

  function showMenu(){
    if (openMenu && openMenu !== menu) {
      openMenu.classList.add('hidden');
      openMenu.anchor?.setAttribute('aria-expanded', 'false');
    }
    document.body.appendChild(menu);
    positionMenu();
    menu.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
    menu.anchor = btn;
    openMenu = menu;
  }

  function positionMenu(){
    const rect = btn.getBoundingClientRect();
    Object.assign(menu.style, {
      position: 'fixed',
      top: `${rect.bottom + 4}px`,
      left: `${Math.max(8, rect.right - 160)}px`,
      minWidth: '160px',
      zIndex: '1000'
    });
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu.classList.contains('hidden')) showMenu(); else hideMenu();
  });

  window.addEventListener('resize', () => { if (!menu.classList.contains('hidden')) positionMenu(); });
  document.addEventListener('click', (e) => {
    if (openMenu === menu && !menu.contains(e.target) && e.target !== btn) hideMenu();
  });

  return { button: btn, menu };
}
