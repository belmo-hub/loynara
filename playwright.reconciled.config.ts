import config from "./playwright.config";
const reconciledConfig = { ...config, use: { ...config.use, baseURL: "http://localhost:3069" } };
export default reconciledConfig;
