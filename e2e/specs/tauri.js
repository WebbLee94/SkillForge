export async function invokeTauriCommand(fn, ...args) {
  await browser.waitUntil(
    async () =>
      (await browser.execute(() => Boolean(window.__TAURI__?.core?.invoke))) === true,
    {
      timeout: 30000,
      interval: 500,
      timeoutMsg: 'window.__TAURI__.core.invoke 未在 30s 内出现',
    }
  );

  const payload = args.length > 0 ? args[0] : undefined;

  return browser.execute(
    (fnSource, invokePayload) => {
      const userFn = eval(`(${fnSource})`);
      return userFn(
        {
          core: {
            invoke: (cmd, cmdPayload) => window.__TAURI__.core.invoke(cmd, cmdPayload),
          },
        },
        invokePayload
      );
    },
    fn.toString(),
    payload
  );
}
