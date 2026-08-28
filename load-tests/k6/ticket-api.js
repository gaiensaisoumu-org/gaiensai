import http from 'k6/http';
import { check, fail } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// 負荷試験は明示的に BASE_URL を指定して実行する。
// 本番環境へ誤って実行されることを避けるため、既定値は設定しない。
const baseUrl = (__ENV.BASE_URL || '').replace(/\/$/, '');
const ticketCode = __ENV.TICKET_CODE || '';

if (!baseUrl) {
  fail('BASE_URL is required. Example: BASE_URL=https://staging.example.com k6 run load-tests/k6/ticket-api.js');
}

const rate = Number(__ENV.RATE || 20);
const duration = __ENV.DURATION || '1m';
const preAllocatedVUs = Number(__ENV.PRE_ALLOCATED_VUS || 10);
const maxVUs = Number(__ENV.MAX_VUS || 50);

const apiErrorRate = new Rate('api_errors');
const availabilityLatency = new Trend('availability_latency', true);
const appDataLatency = new Trend('app_data_latency', true);
const ticketStatusLatency = new Trend('ticket_status_latency', true);
const ticketStatusRequests = new Counter('ticket_status_requests');

export const options = {
  scenarios: {
    ticket_api: {
      executor: 'constant-arrival-rate',
      rate,
      timeUnit: '1s',
      duration,
      preAllocatedVUs,
      maxVUs,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
    api_errors: ['rate<0.01'],
    availability_latency: ['p(95)<800'],
    app_data_latency: ['p(95)<800'],
    ticket_status_latency: ['p(95)<800'],
  },
};

const params = {
  headers: { Accept: 'application/json' },
  tags: { service: 'ticket-api' },
};

function requestJson(name, path, latencyMetric, validate) {
  const response = http.get(`${baseUrl}${path}`, {
    ...params,
    tags: { ...params.tags, endpoint: name },
  });
  latencyMetric.add(response.timings.duration);

  const ok = check(response, {
    [`${name}: HTTP 200`]: (res) => res.status === 200,
    [`${name}: JSON response`]: (res) => {
      try {
        return typeof res.json() === 'object';
      } catch (_) {
        return false;
      }
    },
    [`${name}: expected payload`]: (res) => {
      if (res.status !== 200) return false;
      try {
        return validate(res.json());
      } catch (_) {
        return false;
      }
    },
  });
  apiErrorRate.add(!ok);
}

export default function () {
  requestJson(
    'performances-availability',
    '/performances-availability',
    availabilityLatency,
    (body) => body !== null && typeof body === 'object' && 'data' in body,
  );

  requestJson(
    'app-data-cache',
    '/app-data-cache',
    appDataLatency,
    (body) => body !== null && typeof body === 'object' && Array.isArray(body.configs),
  );

  // 実在するテスト用チケットを指定した場合だけ、照会APIも測定する。
  // このGETはチケットの状態を変更しない。
  if (ticketCode) {
    ticketStatusRequests.add(1);
    requestJson(
      'ticket-status',
      `/app-data-cache/ticket?code=${encodeURIComponent(ticketCode)}`,
      ticketStatusLatency,
      (body) => body !== null && typeof body === 'object' && 'ticket' in body,
    );
  }
}
