import { runLauncher } from "./services";

const launcher = await runLauncher(process.env);
process.once(
  "SIGTERM",
  () => void launcher.close().then(() => process.exit(0)),
);
