const focusableSelector = "input, textarea, select, [contenteditable='true']";

function isEditableElement(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && target.matches(focusableSelector);
}

function isMobileViewport(): boolean {
  return window.matchMedia("(max-width: 768px)").matches || "ontouchstart" in window;
}

function nearestScrollable(element: HTMLElement): HTMLElement | Window {
  let current: HTMLElement | null = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    const canScroll = /(auto|scroll)/.test(`${style.overflowY}${style.overflow}`);
    if (canScroll && current.scrollHeight > current.clientHeight) return current;
    current = current.parentElement;
  }
  return window;
}

function scrollEditableIntoView(element: HTMLElement): void {
  if (!isMobileViewport()) return;
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const rect = element.getBoundingClientRect();
  const topPadding = Math.max(72, Math.round(viewportHeight * 0.18));
  const bottomLimit = viewportHeight - 120;
  const shouldMove = rect.top < topPadding || rect.bottom > bottomLimit;
  if (!shouldMove) return;

  const container = nearestScrollable(element);
  if (!(container instanceof HTMLElement)) {
    window.scrollBy({
      top: rect.top - topPadding,
      behavior: "smooth"
    });
    return;
  }

  const containerRect = container.getBoundingClientRect();
  container.scrollBy({
    top: rect.top - containerRect.top - topPadding,
    behavior: "smooth"
  });
}

export function installMobileKeyboardAssist(): void {
  let activeEditable: HTMLElement | null = null;
  let timer = 0;

  const scheduleScroll = (target: HTMLElement | null = activeEditable) => {
    if (!target) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => scrollEditableIntoView(target), 260);
  };

  document.addEventListener(
    "focusin",
    (event) => {
      if (!isEditableElement(event.target)) return;
      activeEditable = event.target;
      scheduleScroll(event.target);
    },
    { passive: true }
  );

  document.addEventListener(
    "focusout",
    (event) => {
      if (event.target === activeEditable) activeEditable = null;
    },
    { passive: true }
  );

  window.visualViewport?.addEventListener("resize", () => scheduleScroll(), { passive: true });
  window.visualViewport?.addEventListener("scroll", () => scheduleScroll(), { passive: true });
}
