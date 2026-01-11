// API Routes - Proxy to Rust gRPC-Web backend

import { GrpcWebClient } from '../grpc-client';

export interface Env {
  GRPC_API_URL: string;
}

export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  const grpcClient = new GrpcWebClient(env.GRPC_API_URL);

  try {
    // Route handlers
    if (path === '/api/drivers' && request.method === 'GET') {
      const drivers = await grpcClient.getDrivers();
      return jsonResponse(drivers);
    }

    if (path === '/api/driver_id' && request.method === 'GET') {
      const driverId = url.searchParams.get('driver_id');
      if (!driverId) {
        return jsonResponse({ error: 'driver_id is required' }, 400);
      }
      const driver = await grpcClient.getDriverById(parseInt(driverId));
      return jsonResponse(driver);
    }

    if (path === '/api/pic_tmp' && request.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '30');
      const start = url.searchParams.get('start') || undefined;
      const data = await grpcClient.getPicTmp(limit, start);
      return jsonResponse(data);
    }

    if (path === '/api/ic_non_reg' && request.method === 'GET') {
      const items = await grpcClient.getIcNonReg();
      return jsonResponse(items);
    }

    if (path === '/api/ic_non_reg/register' && request.method === 'POST') {
      const body = await request.json() as { ic_id: string; driver_id: number };
      const result = await grpcClient.registerIc(body.ic_id, body.driver_id);
      return jsonResponse(result);
    }

    if (path === '/api/ic_log' && request.method === 'GET') {
      const logs = await grpcClient.getIcLog();
      return jsonResponse(logs);
    }

    return new Response('Not found', { status: 404 });
  } catch (error) {
    console.error('API error:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Internal server error'
    }, 500);
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
