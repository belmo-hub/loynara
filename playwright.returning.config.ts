import config from "./playwright.config";
const returningConfig = { ...config, use: { ...config.use, baseURL: "http://localhost:3049" } };
export default returningConfig;
