// The site's way into Powershell Man: type the secret, and the Toil UI preview's
// game opens in a full-screen dialog that unloads it again on close. Requests to
// ship a homegrown build are routed to Packaging, as the form requires.
const dialog = document.getElementById('powershell-man') as HTMLDialogElement | null;
const closeButton = dialog?.querySelector<HTMLButtonElement>('[data-game-close]');
const frame = dialog?.querySelector<HTMLIFrameElement>('[data-game-frame]');

if (dialog && closeButton && frame) {
  let previousFocus: HTMLElement | null = null;
  const open = () => {
    if (dialog.open) return;
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!frame.src) frame.src = dialog.dataset.gameUrl ?? '';
    dialog.showModal();
    closeButton.focus();
  };

  // The game listens on the frame's own window, so keys reach it only once the
  // frame has focus; Close stays one Shift+Tab away.
  frame.addEventListener('load', () => {
    if (dialog.open && frame.src) frame.contentWindow?.focus();
  });
  closeButton.addEventListener('click', () => dialog.close());
  // Escape belongs to the game while it has focus (it pauses); the persistent
  // close control remains available for leaving the simulator.
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  dialog.addEventListener('close', () => {
    // Stop the game loop and release its keyboard handlers while it is closed.
    frame.removeAttribute('src');
    // A removed frame can keep keyboard focus in its empty browsing context.
    // Return it to the parent document so the secret works again immediately.
    const target = previousFocus?.isConnected && previousFocus !== document.body ? previousFocus : document.body;
    const priorTabIndex = target.getAttribute('tabindex');
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    if (priorTabIndex === null) target.removeAttribute('tabindex');
    else target.setAttribute('tabindex', priorTabIndex);
  });

  let buffer = '';
  let lastKey = 0;
  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    const typing = target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
    if (dialog.open || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || typing) {
      buffer = '';
      return;
    }
    if (event.key.length !== 1 || !/[a-z]/i.test(event.key)) return;
    const now = Date.now();
    if (now - lastKey > 1400) buffer = '';
    lastKey = now;
    buffer = (buffer + event.key.toLowerCase()).slice(-'powershell'.length);
    if (buffer === 'powershell') {
      buffer = '';
      event.preventDefault();
      open();
    }
  }, true);
}
