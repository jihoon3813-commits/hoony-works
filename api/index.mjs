import { createRequestHandler } from '../hoon/hooniworks-antigravity/src/server/app-server.mjs';

const handler = createRequestHandler();

export default async function vercelApiHandler(req, res) {
  return handler(req, res);
}
