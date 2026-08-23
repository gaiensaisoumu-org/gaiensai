/* eslint-disable no-console */
import { getLocalIP } from './ip.ts';
import {
  useTicket,
  logTicketScan,
  getEntryCount,
  getScanLogs,
  getTickets,
  getTicketStatusCacheSummary,
  replaceTicketStatusCache,
  updateScanLogCount,
  updateTicketCount,
  updateTicketUsedAndCount,
  deleteScanLogAndUpdateTicket,
} from './ticket.ts';
import { getOperationLogs, logOperation } from './operationLog.ts';

const ip = await getLocalIP();

logOperation(
  'backend/server.ts:startup',
  '起動',
  '-',
  'ローカルサーバーが起動しました。',
);
console.log(
  '同期サーバーのURLは下記です。使用には同じネットワークへの接続が必要です。',
);
console.log('この端末専用のURL: http://localhost:8000');

if (ip) {
  console.log(
    `同じネットワークに接続されている端末専用のURL: http://${ip}:8000`,
  );
}

function contentType(path: string) {
  if (path.endsWith('.html')) {
    return 'text/html';
  }
  if (path.endsWith('.js')) {
    return 'application/javascript';
  }
  if (path.endsWith('.css')) {
    return 'text/css';
  }
  if (path.endsWith('.json')) {
    return 'application/json';
  }
  if (path.endsWith('.png')) {
    return 'image/png';
  }
  if (path.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  return 'text/plain';
}

Deno.serve(async (req) => {
  // preflight request
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders,
    });
  }

  const url = new URL(req.url);

  // API
  if (url.pathname === '/api' && req.method === 'POST') {
    const body = await req.json();
    const id = body.id.split('.')[0].replace(/-/g, '');
    const allowUnknown = body.allowUnknown === true;

    const result = useTicket(id, body.count ?? 1, { allowUnknown });

    console.log(
      'リクエストを受け付けました。チケットID: ',
      body.id,
      '検証結果: ',
      result,
      '人数:',
      body.count ?? 1,
    );

    return new Response(JSON.stringify(result), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }

  // ログ記録エンドポイント
  if (url.pathname === '/api/log' && req.method === 'POST') {
    const body = await req.json();
    const { code, result, count = 1 } = body;

    if (code && result) {
      const logId = logTicketScan(code, result, count);
      logOperation(
        'backend/server.ts:api/log',
        `使用 (${result})`,
        code.split('.')[0].replace('-', ''),
        'チケットをスキャンしました。',
        'コード(フル):',
        code,
        '結果:',
        result,
        '人数:',
        count ?? 1,
      );
      return new Response(JSON.stringify({ ok: true, logId }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    return new Response(JSON.stringify({ ok: false }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }

  // 人数更新エンドポイント
  if (url.pathname === '/api/count' && req.method === 'POST') {
    const body = await req.json();
    const { logId, code, count } = body;

    if (logId && count !== undefined) {
      updateScanLogCount(logId, count);
      if (code) {
        updateTicketCount(code, count);
      }
      logOperation(
        'backend/server.ts:api/count',
        '人数変更',
        code,
        '人数を更新しました。',
        '読み取り履歴ID:',
        logId,
        '人数:',
        count,
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }

  // 再入場確定エンドポイント（used_at と count を更新）
  if (url.pathname === '/api/reentry' && req.method === 'POST') {
    const body = await req.json();
    const { code, count = 1 } = body;

    if (code !== undefined) {
      updateTicketUsedAndCount(code, count);
      logOperation(
        'backend/server.ts:api/reentry',
        '再入場',
        code,
        '再入場を確定しました。',
        '人数:',
        count,
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }

  // 統計情報エンドポイント（入場者数）
  if (url.pathname === '/api/stats' && req.method === 'GET') {
    const count = getEntryCount();
    return new Response(JSON.stringify({ entryCount: count }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }

  // 読み取り履歴エンドポイント
  if (url.pathname === '/api/records' && req.method === 'GET') {
    const all = url.searchParams.get('all');
    const records = getScanLogs({ all: all === '1' || all === 'true' });
    return new Response(JSON.stringify({ records }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }

  if (url.pathname === '/api/tickets' && req.method === 'GET') {
    const tickets = getTickets();
    return new Response(JSON.stringify({ tickets }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }

  if (url.pathname === '/api/tickets/sync' && req.method === 'POST') {
    const body = await req.json();
    const source = Array.isArray(body?.tickets) ? body.tickets : [];
    const rows = source
      .map((item: { code: string; status: string }) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const code = 'code' in item ? item.code : null;
        const status = 'status' in item ? item.status : null;
        if (typeof code !== 'string' || typeof status !== 'string') {
          return null;
        }
        return { code, status };
      })
      .filter(
        (
          row: { code: string; status: string } | null,
        ): row is { code: string; status: string } => row !== null,
      );

    const result = replaceTicketStatusCache(rows);
    logOperation(
      'backend/server.ts:api/tickets/sync',
      '同期',
      '-',
      'Supabaseのtickets同期を更新しました。',
      '同期件数:',
      result.imported,
      '同期時刻:',
      result.syncedAt,
    );

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }

  if (url.pathname === '/api/tickets/sync-status' && req.method === 'GET') {
    const summary = getTicketStatusCacheSummary();
    return new Response(JSON.stringify(summary), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }

  if (url.pathname === '/api/operation-logs' && req.method === 'GET') {
    const logs = getOperationLogs();
    return new Response(JSON.stringify({ logs }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }

  // 読み取り履歴削除エンドポイント
  if (url.pathname === '/api/records' && req.method === 'DELETE') {
    const body = await req.json();
    const { logId } = body;

    if (logId) {
      const result = deleteScanLogAndUpdateTicket(logId);
      logOperation(
        'backend/server.ts:api/records/delete',
        '削除',
        result.code ?? '-',
        '読み取り履歴を削除しました。',
        '結果:',
        result.ok ? '成功' : '失敗',
        'このチケットの残り読み取り履歴数:',
        result.remaining,
      );
      return new Response(JSON.stringify(result), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    return new Response(JSON.stringify({ ok: false }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  }

  // 静的ファイル
  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = './dist' + path;

  try {
    const file = await Deno.readFile(filePath);
    return new Response(file, {
      headers: {
        'Content-Type': contentType(filePath),
      },
    });
  } catch {
    // SPA fallback
    const index = await Deno.readFile('./dist/index.html');
    return new Response(index, {
      headers: {
        'Content-Type': contentType('/index.html'),
      },
    });
  }
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
