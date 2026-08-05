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

const PRELOAD_ERROR_RELOAD_KEY = 'pwa-preload-error-reload-attempted';
const ENTRY_MODULE_RELOAD_KEY = 'pwa-entry-module-reload-attempted';

// エントリーモジュールの起動に成功したら、前回の復旧試行を解除する。
try {
  sessionStorage.removeItem(PRELOAD_ERROR_RELOAD_KEY);
  sessionStorage.removeItem(ENTRY_MODULE_RELOAD_KEY);
} catch {
  // ストレージが無効な環境でも、アプリの起動自体は継続する。
}

// デプロイ直後に旧版が存在しない分割チャンクを先読みしたときだけ、一度再読込して復旧する。
// 復旧に失敗しても、同じブラウザセッションで無限に再読込しない。
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();

  try {
    if (sessionStorage.getItem(PRELOAD_ERROR_RELOAD_KEY)) {
      return;
    }
    sessionStorage.setItem(PRELOAD_ERROR_RELOAD_KEY, '1');
  } catch {
    // ストレージが使えない場合は、リロードループ回避を優先する。
    return;
  }

  window.location.reload();
});

render(<App />, document.getElementById('app')!);
