interface TurnstileWindow extends Window {
  turnstile?: {
    render: (container: HTMLElement, options: {
      sitekey: string;
      callback?: string;
      theme?: "light" | "dark" | "auto";
    }) => string;
    reset: (widgetId: string) => void;
    remove: (widgetId: string) => void;
  };
}

declare global {
  interface Window extends TurnstileWindow {}
}

export {};
