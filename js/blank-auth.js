/* Blank stage gate — client-side unlock before the resting lattice mounts.
   Keeps casual visitors out. Not server-side security on a static host. */

const PASS_HASH =
  '0bf8a18dc77de384b64e6094d4a45ffa1921d8b6cd6852bf7b803afb51b08214';
const STORAGE_KEY = 'blank-stage-unlocked';

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function unlockBlankStage() {
  document.body.dataset.blankUnlocked = '';
  try {
    sessionStorage.setItem(STORAGE_KEY, PASS_HASH);
  } catch (_) {
    /* private mode / blocked storage — unlock still works for this load */
  }
  const gate = document.getElementById('blank-gate');
  if (gate) gate.hidden = true;
  const frame = document.getElementById('site-frame');
  if (frame) frame.removeAttribute('aria-hidden');
  await import('./blank-stage.js');
}

function showError(message) {
  const err = document.getElementById('blank-gate-error');
  if (!err) return;
  err.textContent = message;
  err.hidden = !message;
}

async function tryStoredUnlock() {
  try {
    if (sessionStorage.getItem(STORAGE_KEY) === PASS_HASH) {
      await unlockBlankStage();
      return true;
    }
  } catch (_) {
    /* ignore */
  }
  return false;
}

async function onSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('blank-gate-password');
  const value = input ? String(input.value || '') : '';
  if (!value) {
    showError('Enter the password.');
    return;
  }
  const hash = await sha256Hex(value);
  if (hash !== PASS_HASH) {
    showError('Incorrect password.');
    if (input) {
      input.value = '';
      input.focus();
    }
    return;
  }
  showError('');
  await unlockBlankStage();
}

(async function initBlankAuth() {
  'use strict';

  if (await tryStoredUnlock()) return;

  const form = document.getElementById('blank-gate-form');
  const input = document.getElementById('blank-gate-password');
  if (form) form.addEventListener('submit', onSubmit);
  if (input) input.focus();
})();
