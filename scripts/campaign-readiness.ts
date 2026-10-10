import { campaignReadiness } from "../src/lib/email-configuration";

// Read the caller's environment only; never load files, send mail or activate a gate.
process.stdout.write(`${JSON.stringify(campaignReadiness(process.env), null, 2)}\n`);
