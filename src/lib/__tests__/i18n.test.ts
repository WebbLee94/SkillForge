import { describe, it, expect, vi, beforeEach } from 'vitest';

const LANG_STORAGE_KEY = 'skillforge-lang';

/**
 * Helper: reset module registry + mock i18next deps + locale JSON,
 * set up localStorage/navigator, then dynamically import ../i18n.
 * Returns the init mock function so we can assert what `lng` was passed.
 */
async function importI18nWithMocks(
  storageValue: string | null,
  browserLang: string
) {
  vi.resetModules();

  const store: Record<string, string> = {};

  // Replace localStorage
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = val;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        Object.keys(store).forEach((k) => delete store[k]);
      },
      length: Object.keys(store).length,
      key: (index: number) => Object.keys(store)[index] ?? null,
    },
    configurable: true,
    writable: true,
  });

  // Set stored value if provided
  if (storageValue !== null) {
    store[LANG_STORAGE_KEY] = storageValue;
  }

  // Mock navigator.language
  Object.defineProperty(navigator, 'language', {
    value: browserLang,
    configurable: true,
    writable: true,
  });

  // Mock i18next default export — capture init call
  const initMock = vi.fn().mockReturnThis();
  const useMock = vi.fn().mockReturnThis();
  vi.doMock('i18next', () => ({
    default: { use: useMock, init: initMock },
  }));
  vi.doMock('react-i18next', () => ({
    initReactI18next: {},
  }));

  // Mock all locale JSON files to avoid import errors
  vi.doMock('../locales/zh-CN/common.json', () => ({}));
  vi.doMock('../locales/zh-CN/skills.json', () => ({}));
  vi.doMock('../locales/zh-CN/rules.json', () => ({}));
  vi.doMock('../locales/zh-CN/scenes.json', () => ({}));
  vi.doMock('../locales/zh-CN/distribution.json', () => ({}));
  vi.doMock('../locales/zh-CN/settings.json', () => ({}));
  vi.doMock('../locales/en-US/common.json', () => ({}));
  vi.doMock('../locales/en-US/skills.json', () => ({}));
  vi.doMock('../locales/en-US/rules.json', () => ({}));
  vi.doMock('../locales/en-US/scenes.json', () => ({}));
  vi.doMock('../locales/en-US/distribution.json', () => ({}));
  vi.doMock('../locales/en-US/settings.json', () => ({}));

  await import('../i18n');

  return { initMock, useMock };
}

describe('i18n initialization', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses stored zh-CN value from localStorage', async () => {
    const { initMock } = await importI18nWithMocks('zh-CN', 'en-US');
    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({ lng: 'zh-CN' })
    );
  });

  it('uses stored en-US value from localStorage', async () => {
    const { initMock } = await importI18nWithMocks('en-US', 'zh-CN');
    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({ lng: 'en-US' })
    );
  });

  it('falls back to navigator.language when stored value is "system"', async () => {
    const { initMock } = await importI18nWithMocks('system', 'zh-CN');
    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({ lng: 'zh-CN' })
    );
  });

  it('falls back to en-US when browser language is not zh-*', async () => {
    const { initMock } = await importI18nWithMocks('system', 'fr-FR');
    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({ lng: 'en-US' })
    );
  });

  it('uses zh-CN when no stored value and browser is zh-CN', async () => {
    const { initMock } = await importI18nWithMocks(null, 'zh-CN');
    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({ lng: 'zh-CN' })
    );
  });

  it('uses zh-CN for zh-TW browser language (zh-* prefix)', async () => {
    const { initMock } = await importI18nWithMocks('system', 'zh-TW');
    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({ lng: 'zh-CN' })
    );
  });

  it('uses en-US when no stored value and browser is en-US', async () => {
    const { initMock } = await importI18nWithMocks(null, 'en-US');
    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({ lng: 'en-US' })
    );
  });

  it('calls use(initReactI18next) before init', async () => {
    const { useMock, initMock } = await importI18nWithMocks(null, 'zh-CN');
    // use() should have been called before init()
    expect(useMock).toHaveBeenCalledWith({});
    expect(initMock).toHaveBeenCalled();
    // use() returns the i18n instance for chaining
    expect(initMock).toHaveBeenCalledAfter(useMock as any);
  });

  it('uses fallbackLng en-US in init config', async () => {
    const { initMock } = await importI18nWithMocks(null, 'zh-CN');
    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackLng: 'en-US' })
    );
  });

  it('uses defaultNS common in init config', async () => {
    const { initMock } = await importI18nWithMocks(null, 'zh-CN');
    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultNS: 'common' })
    );
  });
});
