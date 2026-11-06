import { runEgressProxy } from "./services";

const proxy = await runEgressProxy(process.env);
process.once("SIGTERM", () => proxy.close(() => process.exit(0)));
