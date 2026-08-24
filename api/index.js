import serverless from "serverless-http";
import app from "../src/app.js";

// Vercel wraps this Express app as a single serverless function handling
// every /api/* route (see vercel.json rewrites).
export default serverless(app);
