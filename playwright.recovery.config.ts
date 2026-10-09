import config from "./playwright.config";
const recoveryConfig = { ...config, use: { ...config.use, baseURL: "http://localhost:3059", actionTimeout: 10_000 } };
export default recoveryConfig;
