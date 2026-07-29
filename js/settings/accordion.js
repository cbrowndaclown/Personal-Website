/* Accordion manager — section open/close; unlimited concurrent sections by default. */

/**
 * @param {object} opts
 * @param {HTMLElement} opts.container
 * @param {Array<{ id: string, isOpen: () => boolean, setOpen: (o: boolean, a?: boolean) => void, root: HTMLElement }>} opts.sections
 * @param {number} [opts.maxOpen] — optional cap; omit or pass Infinity for unlimited
 */
export function bindAccordion(opts) {
  const maxOpen = opts.maxOpen;
  const limited = Number.isFinite(maxOpen) && maxOpen > 0;
  /** @type {string[]} */
  const openOrder = [];

  opts.sections.forEach((section) => {
    if (section.isOpen()) openOrder.push(section.id);
  });

  opts.container.addEventListener('settingssectiontoggle', (e) => {
    const { id, open } = e.detail || {};
    const section = opts.sections.find((s) => s.id === id);
    if (!section) return;

    if (open) {
      section.setOpen(true, true);
      const idx = openOrder.indexOf(id);
      if (idx !== -1) openOrder.splice(idx, 1);
      openOrder.push(id);

      if (limited) {
        while (openOrder.length > maxOpen) {
          const closeId = openOrder.shift();
          const other = opts.sections.find((s) => s.id === closeId);
          if (other && other.isOpen()) other.setOpen(false, true);
        }
      }
    } else {
      section.setOpen(false, true);
      const idx = openOrder.indexOf(id);
      if (idx !== -1) openOrder.splice(idx, 1);
    }
  });
}
