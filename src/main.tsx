/*!
 * 外苑祭チケットシステム
 * Web Site: https://gaiensai.com/
 * Git Repository: https://github.com/gaiensaisoumu/gaiensai
 *
 * Copyright (c) 2026 Rio Gunawan(aoym 79th)
 *  and Gaiensai Festival General Affairs Committee, Tokyo Metropolitan Aoyama High School
 * Released under the MIT license.
 * See https://github.com/gaiensaisoumu/gaiensai/blob/main/LICENSE
 */

import { render } from 'preact';
import App from './App';

// デプロイ直後に旧版が存在しない分割チャンクを先読みしたときだけ、一度再読込して復旧する。
// 同一URLで繰り返さないため、継続的な配信障害ではリロードループにならない。
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();

  const failedUrl = String(
    (event as Event & { payload?: unknown }).payload ?? location.href,
  );
  const recoveryKey = `vite-preload-recovery:${failedUrl}`;

  try {
    if (sessionStorage.getItem(recoveryKey)) {
      return;
    }
    sessionStorage.setItem(recoveryKey, '1');
  } catch {
    // sessionStorage が利用できない環境でも、一度は復旧を試みる。
  }

  window.location.reload();
});

render(<App />, document.getElementById('app')!);
