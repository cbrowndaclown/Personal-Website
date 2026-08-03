/* Settings control — action button for settings that do rather than store. */

/**
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} opts.label  Text on the button itself
 * @param {string} [opts.labelledBy]
 * @param {() => void} opts.onPress
 * @returns {{ root: HTMLElement, setLabel: (text: string) => void, setLocked: (on: boolean) => void }}
 */
export function createActionButton(opts) {
  const root = document.createElement('button');
  root.type = 'button';
  root.className = 'settings__action';
  root.id = opts.id;
  root.textContent = opts.label;
  if (opts.labelledBy) root.setAttribute('aria-labelledby', opts.labelledBy);

  let locked = false;

  function setLabel(text) {
    if (root.textContent !== text) root.textContent = text;
  }

  function setLocked(on) {
    const next = !!on;
    if (locked === next) return;
    locked = next;
    root.disabled = locked;
  }

  root.addEventListener('click', () => {
    if (locked) return;
    opts.onPress();
  });

  return { root, setLabel, setLocked };
}
