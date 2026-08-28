import { describe, it, expect, vi, beforeEach } from 'vitest';

const LANG_STORAGE_KEY = 'skillforge-lang';

/**
 * Helper: reset module registry + mock i18next deps + locale JSON,
 * set up localStorage/navigator, then dynamically import ../i18n.
 * Returns the init mock function so we can assert what `lng` was passed.
 */
async function importI18nWithMocks(
  storageValue: string | null,
  browserLang: string,
  systemLocale: string | null = 'zh-CN'
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
  const changeLanguageMock = vi.fn().mockResolvedValue(undefined);
  vi.doMock('i18next', () => ({
    default: { use: useMock, init: initMock, changeLanguage: changeLanguageMock },
  }));
  vi.doMock('react-i18next', () => ({
    initReactI18next: {},
  }));

  vi.doMock('../ipc', () => ({
    ipc: {
      getSystemLocale: vi.fn(async () => systemLocale),
    },
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

  const mod = await import('../i18n');
  await mod.initI18n();

  return { initMock, useMock, changeLanguageMock, mod };
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
    const { changeLanguageMock } = await importI18nWithMocks('en-US', 'zh-CN');
    expect(changeLanguageMock).toHaveBeenCalledWith('en-US');
  });

  it('falls back to system locale when stored value is "system"', async () => {
    const { changeLanguageMock } = await importI18nWithMocks('system', 'en-US', 'zh-CN');
    expect(changeLanguageMock).toHaveBeenCalledWith('zh-CN');
  });

  it('falls back to en-US when system locale is not zh-*', async () => {
    const { changeLanguageMock } = await importI18nWithMocks('system', 'fr-FR', 'fr-FR');
    expect(changeLanguageMock).toHaveBeenCalledWith('en-US');
  });

  it('uses zh-CN when no stored value and system locale is zh-CN', async () => {
    const { changeLanguageMock } = await importI18nWithMocks(null, 'en-US', 'zh-CN');
    expect(changeLanguageMock).toHaveBeenCalledWith('zh-CN');
  });

  it('uses zh-CN for zh-TW system locale (zh-* prefix)', async () => {
    const { changeLanguageMock } = await importI18nWithMocks('system', 'en-US', 'zh-TW');
    expect(changeLanguageMock).toHaveBeenCalledWith('zh-CN');
  });

  it('uses en-US when no stored value and system locale is en-US', async () => {
    const { changeLanguageMock } = await importI18nWithMocks(null, 'zh-CN', 'en-US');
    expect(changeLanguageMock).toHaveBeenCalledWith('en-US');
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
