/* Collapsible settings section — inspector-style category. */

/**
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} opts.title
 * @param {boolean} [opts.defaultOpen]
 * @param {string} [opts.className] — extra class(es), e.g. nested subsection chrome
 * @param {(body: HTMLElement, helpers: object) => void} [opts.build]
 * @param {object} [opts.helpers] — setTitle + any host helpers passed into build
 * @returns {{
 *   id: string,
 *   root: HTMLElement,
 *   body: HTMLElement,
 *   isOpen: () => boolean,
 *   setOpen: (open: boolean, animate?: boolean) => void,
 *   setTitle: (text: string) => void
 * }}
 */
export function createSection(opts) {
  const root = document.createElement('section');
  root.className = ['settings__section', opts.className].filter(Boolean).join(' ');
  root.dataset.section = opts.id;

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'settings__section-header';
  header.id = `settings-section-${opts.id}-header`;
  header.setAttribute('aria-expanded', 'false');
  header.setAttribute('aria-controls', `settings-section-${opts.id}-panel`);

  const chevron = document.createElement('span');
  chevron.className = 'settings__section-chevron';
  chevron.setAttribute('aria-hidden', 'true');

  const title = document.createElement('span');
  title.className = 'settings__section-title';
  title.textContent = opts.title;

  header.append(chevron, title);

  const panel = document.createElement('div');
  panel.className = 'settings__section-panel';
  panel.id = `settings-section-${opts.id}-panel`;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-labelledby', header.id);
  panel.hidden = true;

  const body = document.createElement('div');
  body.className = 'settings__section-body';
  panel.appendChild(body);

  root.append(header, panel);

  function setTitle(text) {
    title.textContent = text;
  }

  if (typeof opts.build === 'function') {
    opts.build(body, { setTitle, ...(opts.helpers || {}) });
  }

  let open = false;
  let animToken = 0;

  function setOpen(next, animate) {
    const want = !!next;
    if (want === open) return;
    open = want;
    root.classList.toggle('is-open', open);
    header.setAttribute('aria-expanded', open ? 'true' : 'false');

    const token = ++animToken;
    const reduce =
      animate === false ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduce) {
      panel.hidden = !open;
      if (open) {
        panel.style.height = 'auto';
        panel.style.opacity = '1';
      } else {
        panel.style.height = '';
        panel.style.opacity = '';
      }
      return;
    }

    if (open) {
      panel.hidden = false;
      panel.style.height = '0px';
      panel.style.opacity = '0';
      void panel.offsetHeight;
      panel.style.height = `${body.scrollHeight}px`;
      panel.style.opacity = '1';

      const onEnd = (e) => {
        if (e.propertyName !== 'height' || token !== animToken) return;
        panel.removeEventListener('transitionend', onEnd);
        if (!open) return;
        panel.style.height = 'auto';
      };
      panel.addEventListener('transitionend', onEnd);
    } else {
      const current = panel.scrollHeight;
      panel.style.height = `${current}px`;
      panel.style.opacity = '1';
      void panel.offsetHeight;
      panel.style.height = '0px';
      panel.style.opacity = '0';

      const onEnd = (e) => {
        if (e.propertyName !== 'height' || token !== animToken) return;
        panel.removeEventListener('transitionend', onEnd);
        if (open) return;
        panel.hidden = true;
        panel.style.height = '';
        panel.style.opacity = '';
      };
      panel.addEventListener('transitionend', onEnd);
    }
  }

  header.addEventListener('click', () => {
    root.dispatchEvent(
      new CustomEvent('settingssectiontoggle', {
        bubbles: true,
        detail: { id: opts.id, open: !open },
      })
    );
  });

  if (opts.defaultOpen) {
    setOpen(true, false);
  }

  return {
    id: opts.id,
    root,
    body,
    isOpen: () => open,
    setOpen,
    setTitle,
  };
}
