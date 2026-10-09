// playwright-crx 没有随包提供这些类型。这里只声明扩展实际调用的方法。
declare module "playwright-crx" {
  export interface CrxDialog {
    message(): string;
    accept(): Promise<void>;
  }

  export interface CrxLocator {
    click(options?: { timeout?: number }): Promise<void>;
    fill(value: string, options?: { timeout?: number }): Promise<void>;
    selectOption(value: string, options?: { timeout?: number }): Promise<unknown>;
    press(key: string, options?: { timeout?: number }): Promise<void>;
    getAttribute(name: string): Promise<string | null>;
    innerText(): Promise<string>;
    evaluate<T>(pageFunction: (element: Element, arg: string) => T, arg: string): Promise<T>;
  }

  export interface CrxPage {
    goto(url: string, options?: { waitUntil?: "domcontentloaded" }): Promise<unknown>;
    url(): string;
    on(event: "dialog", handler: (dialog: CrxDialog) => void): void;
    locator(selector: string): CrxLocator;
  }

  export interface CrxApplication {
    attach(tabId: number): Promise<CrxPage>;
    detach(page: CrxPage): Promise<void>;
    close(): Promise<void>;
    newPage(): Promise<CrxPage>;
  }

  export const crx: {
    start(options?: { slowMo?: number }): Promise<CrxApplication>;
  };
}
