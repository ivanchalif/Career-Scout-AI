/** Outside activity starts a fixed two-second grace period; moving around
 * outside must not keep extending it. Returning inside cancels that deadline.
 */
export function startModalAutoDismiss(element: HTMLElement, owner: string, onDismiss: () => void) {
  const document = element.ownerDocument;
  let idleTimer: ReturnType<typeof setTimeout>;
  let outsideTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function stop() {
    stopped = true;
    clearTimeout(idleTimer);
    clearTimeout(outsideTimer);
    for (const event of ["pointermove", "pointerdown", "wheel"]) document.removeEventListener(event, pointerActivity, true);
    for (const event of ["keydown", "input"]) document.removeEventListener(event, keyboardActivity, true);
  }
  function dismiss() {
    if (stopped) return;
    stop();
    onDismiss();
  }
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(dismiss, 3000);
  }
  function inside(target: EventTarget | null) {
    // Menus are portaled outside the content DOM, but retain their modal owner.
    const node = target as Element | null;
    return !!node && (element.contains(node) || node.closest?.("[data-modal-owner]")?.getAttribute("data-modal-owner") === owner);
  }
  function returnInside() {
    clearTimeout(outsideTimer);
    outsideTimer = undefined;
  }
  function pointerActivity(event: Event) {
    if (stopped) return;
    resetIdle();
    if (inside(event.target)) returnInside();
    else if (outsideTimer === undefined) outsideTimer = setTimeout(dismiss, 2000);
  }
  function keyboardActivity(event: Event) {
    if (stopped || !inside(event.target)) return;
    returnInside();
    resetIdle();
  }
  for (const event of ["pointermove", "pointerdown", "wheel"]) document.addEventListener(event, pointerActivity, true);
  for (const event of ["keydown", "input"]) document.addEventListener(event, keyboardActivity, true);
  resetIdle();
  return stop;
}
