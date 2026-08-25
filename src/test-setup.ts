import '@testing-library/jest-dom';

/**
 * jsdom 29 + vitest 4 + Node 22+ 组合下，window.localStorage 不可用
 * （Node 22+ 的实验性全局 localStorage getter 需要 --localstorage-file 标志，
 * 且 jsdom 的 window.localStorage 在 vitest 4 环境中未正确挂载）。
 * 此处仅在缺失时安装一个内存版 polyfill，保证依赖 localStorage 的
 * 组件（如 Dashboard 的首启引导持久化）可以正常测试。
 */
if (
  typeof window !== 'undefined' &&
  typeof window.localStorage === 'undefined'
) {
  const store = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };

  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    configurable: true,
    writable: true,
  });
}
