// Vercel entry: the same fetch handler as server.mjs, in the Web-handler form (export default { fetch }).
import { createApp } from "../app.mjs";

const app = createApp(process.env);

export default { fetch: (request) => app(request) };
