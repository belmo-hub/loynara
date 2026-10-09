import config from "./playwright.config";
const finalPolicyConfig = { ...config, use: { ...config.use, baseURL: "http://localhost:3079" } };
export default finalPolicyConfig;
