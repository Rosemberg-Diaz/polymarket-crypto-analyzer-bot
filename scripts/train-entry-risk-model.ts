import { connectDatabase, disconnectDatabase } from "../src/database/client";
import { LoggerService } from "../src/modules/logger/logger.service";
import { EntryRiskModelService } from "../src/modules/learning/entry-risk-model.service";

async function main(): Promise<void> {
  await connectDatabase();
  const artifact = await new EntryRiskModelService(
    new LoggerService("info")
  ).trainAndSave();
  console.log(JSON.stringify(artifact, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
