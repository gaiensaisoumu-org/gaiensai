import { getEnv } from './getEnv.ts';
import HttpError from './HttpError.ts';

/** Cloudflare Pages のデプロイフックを、秘密情報をクライアントへ渡さずに実行する。 */
export const triggerCloudflarePagesDeploy = async () => {
  const response = await fetch(getEnv('CLOUDFLARE_PAGES_DEPLOY_HOOK_URL'), {
    method: 'POST',
  });

  if (!response.ok) {
    throw new HttpError(502, 'Cloudflare Pages の再デプロイ開始に失敗しました。');
  }
};
