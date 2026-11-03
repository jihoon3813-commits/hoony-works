// HooniWorks Application & API Server (Static UI + Workspace/Auth/Generation/MP4/Publish API)
import { createHooniServer } from '../src/server/app-server.mjs';

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer from 1 to 65535');
}

const server = createHooniServer();
server.on('error', err => {
  console.error(err.code === 'EADDRINUSE' ? 'Port already in use. Close the other server or set PORT.' : err.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`HooniWorks server running at: http://127.0.0.1:${port}`);
});
