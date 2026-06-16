import { connectDatabase, disconnectDatabase } from "../src/database/client";
import { LoggerService } from "../src/modules/logger/logger.service";
import { OutcomeModelService } from "../src/modules/learning/outcome-model.service";

async function main(): Promise<void> {
  await connectDatabase();
  const artifacts = await new OutcomeModelService(
    new LoggerService("info")
  ).trainAllAndSave();
  console.log(JSON.stringify(artifacts, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
