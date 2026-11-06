import app from "./app";
import { logger } from "./lib/logger";
import { startGmailScheduler } from "./lib/gmailScheduler";
import { startOnlineDiscoveryScheduler } from "./lib/onlineDiscovery";
import { startScoringWorker } from "./lib/scoringQueue";
import { protectLegacyMailboxCredentials } from "./lib/mailboxCredentials";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  startGmailScheduler();
  startScoringWorker();
  void protectLegacyMailboxCredentials().catch((err) => logger.error({ err }, "Could not protect legacy mailbox credentials"));
  startOnlineDiscoveryScheduler();
});
